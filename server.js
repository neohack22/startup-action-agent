const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MULEROUTER_BASE_URL = process.env.MULEROUTER_BASE_URL;
const MULEROUTER_API_KEY = process.env.MULEROUTER_API_KEY;

// ---- SYSTEM PROMPT ----
const SYSTEM_PROMPT = `You are a startup progress analysis agent. Your job is to analyze a raw weekly startup update and produce a structured JSON response.

CRITICAL FRAMING RULES:
- You are NOT a business advice dashboard. You are a build / automate / delegate console.
- Every recommendation must be framed as something to BUILD, AUTOMATE, or DELEGATE to an AI/agent.
- "Manual" is only a fallback when nothing can reasonably be built or automated.
- Default bias: build > automate > delegate > manual.
- A recommendation is NEVER an executed action. A prepared draft is NEVER a completed action.

REFRAMING EXAMPLES:
- "Improve investor communication" -> "Build an investor update workflow"
- "Do more user research" -> "Build an interview synthesis agent"
- "Improve sales follow-up" -> "Automate lead follow-up triage"
- "Clarify priorities" -> "Build a weekly prioritization assistant"
- "Track metrics better" -> "Build a metrics dashboard scaffold"

ANALYSIS STEPS:
1. Parse the raw update for: team size, sales activity, revenue, users talked to, product progress, biggest learning, biggest obstacle, morale, goals.
2. Assess momentum (positive / neutral / negative).
3. Identify the main bottleneck.
4. Determine the highest-leverage thing to BUILD, AUTOMATE, or DELEGATE.
5. Explain why this is the leverage point (compounding value, repeating cost, structured process).
6. Explain why it should not stay manual.
7. Determine the current task state and what the human should do now.
8. List what the agent has actually done (analysis, spec generation, brief creation).
9. List what is prepared for review but NOT executed.

You MUST respond with valid JSON matching this exact schema (no markdown, no code fences, just raw JSON):

{
  "run_id": "run_<random_6_chars>",
  "status": "success",
  "build_now": {
    "title": "string - imperative, implementation-focused title",
    "reason": "string - 1-2 sentences explaining what to build and why",
    "execution_mode": "build | automate | delegate | manual",
    "actor": "user | agent",
    "cta_label": "Build now | Review workflow | Launch agent | Add info | View draft",
    "action_type": "do | check | add_info | view_draft | launch"
  },
  "leverage_point": {
    "summary": "string - why this creates compounding value or eliminates repeating cost"
  },
  "why_not_manual": {
    "summary": "string - why this specific problem should be software/automation, not ad hoc effort"
  },
  "current_task": {
    "title": "string - the current task name",
    "state": "do | check | add_info",
    "state_label": "Do | Check | Add info",
    "description": "string - one line explaining the task status"
  },
  "what_to_do_now": {
    "title": "string - short title",
    "instruction": "string - one concrete, immediately actionable human step"
  },
  "what_comes_next": {
    "title": "string - what happens after the current step",
    "instruction": "string - what the system or user does next"
  },
  "built_or_configured_by_agent": [
    {
      "label": "string",
      "description": "string",
      "type": "workflow | agent_spec | prompt_pack | scaffold | doc"
    }
  ],
  "prepared_for_review": [
    {
      "label": "string",
      "description": "string",
      "type": "draft | plan | spec | prompt | config"
    }
  ],
  "supporting_artifacts": [
    {
      "label": "string - filename",
      "path": "string - filename",
      "type": "markdown | json"
    }
  ],
  "analysis_details": {
    "summary": "string - 2-3 sentence factual summary",
    "signals": ["string - each a concrete signal from the update"],
    "learnings": ["string - what the team learned"],
    "momentum": "positive | neutral | negative",
    "momentum_label": "string - momentum with short explanation",
    "bottleneck": "string - the main constraint",
    "sponsor_note": "string - 2-3 sentence note as if from a program sponsor"
  }
}

RULES:
- built_or_configured_by_agent should always include "Weekly signal analysis" and "Startup brief generated".
- prepared_for_review should include at least one draft relevant to the build_now recommendation.
- supporting_artifacts should always include "startup_brief.md" and "portfolio_record.json".
- Keep all text concise and operational. No hype. No filler.
- The build_now.title must start with a verb: Build, Create, Automate, Configure, Launch, Set up.
- If information is missing from the update, set current_task.state to "add_info" and explain what's needed.`;

// ---- API ENDPOINT ----
app.post('/api/analyze', async (req, res) => {
  const { raw_update, startup_name, week_of, role_hint, extra_context } = req.body;

  if (!raw_update || !raw_update.trim()) {
    return res.status(400).json({ error: 'raw_update is required' });
  }

  // Build the user message
  let userMsg = `Raw weekly update:\n${raw_update.trim()}`;
  if (startup_name) userMsg += `\n\nStartup name: ${startup_name}`;
  if (week_of) userMsg += `\nWeek of: ${week_of}`;
  if (role_hint) userMsg += `\nRole: ${role_hint}`;
  if (extra_context) userMsg += `\nExtra context: ${extra_context}`;

  try {
    const response = await fetch(`${MULEROUTER_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MULEROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('LLM API error:', response.status, errText);
      return res.status(502).json({ error: 'AI analysis failed. Please try again.' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: 'Empty response from AI.' });
    }

    // Parse the JSON from the LLM response
    // Strip markdown fences if present
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const result = JSON.parse(jsonStr);

    // Validate required fields
    if (!result.build_now || !result.current_task || !result.what_to_do_now) {
      return res.status(502).json({ error: 'Incomplete analysis. Please try again.' });
    }

    res.json(result);
  } catch (err) {
    console.error('Analysis error:', err);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned invalid output. Please try again.' });
    }
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---- DOCUMENT GENERATION ENDPOINT ----
const DOC_SYSTEM_PROMPT = `You are a startup operations document generator. Given context about a startup's weekly update and analysis, you produce the requested document.

RULES:
- Write in markdown format.
- Be concrete, operational, and concise.
- No filler, no hype.
- Use the startup context to make the document specific, not generic.
- If generating a JSON file (like portfolio_record.json), output valid JSON only — no markdown fences, no explanation.
- If generating a plan or spec, use clear headings and actionable items.
- If generating a draft (like an investor update), write in the founder's voice — direct, honest, specific.`;

// In-memory store for the last analysis result per session (simplified)
let lastAnalysisContext = {};

app.post('/api/generate-doc', async (req, res) => {
  const { doc_label, doc_type, context_summary, raw_update } = req.body;

  if (!doc_label) {
    return res.status(400).json({ error: 'doc_label is required' });
  }

  const userMsg = `Generate the following document: "${doc_label}" (type: ${doc_type || 'markdown'})

Context from the weekly update analysis:
${context_summary || 'No additional context provided.'}

Raw weekly update for reference:
${raw_update || 'Not provided.'}

Generate the full document content now. If the document type is JSON, output raw valid JSON only.`;

  try {
    const response = await fetch(`${MULEROUTER_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MULEROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: DOC_SYSTEM_PROMPT },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Doc generation error:', response.status, errText);
      return res.status(502).json({ error: 'Document generation failed.' });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    // Strip markdown fences if wrapping the entire output
    content = content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:\w+)?\s*\n?/, '').replace(/\n?\s*```$/, '');
    }

    res.json({ content, label: doc_label, type: doc_type || 'markdown' });
  } catch (err) {
    console.error('Doc generation error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---- PROCEED / EXECUTE NEXT STEP ----
const PROCEED_SYSTEM_PROMPT = `You are a startup automation builder. The user has reviewed and approved a document or spec. Now you must execute the next concrete step: produce the actual deliverable that was promised.

RULES:
- You are NOT giving advice. You are BUILDING something.
- Produce the actual artifact: the filled-in template, the configured workflow, the populated list, the ready-to-use output.
- Be concrete and specific to this startup's context.
- Use markdown format.
- If the step involves a list (e.g. investor list), populate it with realistic, actionable entries based on context.
- If the step involves a workflow or automation config, write it as a concrete spec with steps, triggers, and templates.
- If the step involves a draft, write the full draft ready to send.
- End with a "## Next Step" section that says what the user should do after this deliverable.

CRITICAL JSON RULES:
- You MUST respond with valid JSON only. No markdown fences, no explanation outside the JSON.
- All string values must have newlines escaped as \\n (not literal newlines).
- All double quotes inside string values must be escaped as \\"
- Keep step_content SHORT: use bullet points, not long paragraphs. Max 15 lines.

JSON schema:
{
  "step_title": "string - what was just built",
  "step_content": "string - short markdown summary of the deliverable, use \\n for newlines",
  "step_type": "workflow | list | draft | config | scaffold",
  "what_was_done": "string - one sentence describing what the agent just produced",
  "next_step": {
    "title": "string - what to do next",
    "instruction": "string - concrete next action"
  },
  "task_state": "done | check",
  "task_state_label": "Done | Check"
}`;

app.post('/api/proceed', async (req, res) => {
  const { approved_doc_label, approved_doc_content, context_summary, raw_update, feedback } = req.body;

  if (!approved_doc_label) {
    return res.status(400).json({ error: 'approved_doc_label is required' });
  }

  let userMsg = `The user has reviewed and approved: "${approved_doc_label}"`;
  if (feedback) {
    userMsg += `\n\nUser feedback/changes requested: ${feedback}`;
  }
  if (approved_doc_content) {
    userMsg += `\n\nApproved document content:\n${approved_doc_content.substring(0, 2000)}`;
  }
  userMsg += `\n\nAnalysis context:\n${context_summary || 'None'}`;
  userMsg += `\n\nOriginal weekly update:\n${raw_update || 'Not provided'}`;
  userMsg += `\n\nNow execute the next step. Produce the actual deliverable that was promised after this approval. Build it, don't describe it.`;

  try {
    const response = await fetch(`${MULEROUTER_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MULEROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: PROCEED_SYSTEM_PROMPT },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Proceed error:', response.status, errText);
      return res.status(502).json({ error: 'Execution step failed. Please try again.' });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:\w+)?\s*\n?/, '').replace(/\n?\s*```$/, '');
    }

    // Try to fix common LLM JSON issues (unescaped newlines in strings)
    let jsonStr = content;
    try {
      var result = JSON.parse(jsonStr);
    } catch (firstErr) {
      // Attempt repair: escape literal newlines inside JSON string values
      jsonStr = jsonStr.replace(/(?<=:\s*")([\s\S]*?)(?="(?:\s*[,}]))/g, function(match) {
        return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      });
      try {
        var result = JSON.parse(jsonStr);
      } catch (secondErr) {
        // Last resort: extract fields manually
        console.error('JSON repair failed, attempting field extraction');
        var titleMatch = content.match(/"step_title"\s*:\s*"([^"]+)"/);
        var doneMatch = content.match(/"what_was_done"\s*:\s*"([^"]+)"/);
        var nextTitleMatch = content.match(/"title"\s*:\s*"([^"]+)"/g);
        var nextInstrMatch = content.match(/"instruction"\s*:\s*"([^"]+)"/);

        // Extract step_content between its quotes (may span lines)
        var contentMatch = content.match(/"step_content"\s*:\s*"([\s\S]*?)"\s*,\s*"step_type"/);
        var stepContent = contentMatch ? contentMatch[1].replace(/\n/g, '\\n') : 'See details in the downloaded file.';

        var result = {
          step_title: titleMatch ? titleMatch[1] : 'Deliverable ready',
          step_content: stepContent,
          step_type: 'scaffold',
          what_was_done: doneMatch ? doneMatch[1] : 'The agent produced the next deliverable.',
          next_step: {
            title: nextTitleMatch && nextTitleMatch.length > 1 ? nextTitleMatch[1].replace(/"title"\s*:\s*"/, '') : 'Review the output',
            instruction: nextInstrMatch ? nextInstrMatch[1] : 'Review what was generated and decide on next steps.'
          },
          task_state: 'check',
          task_state_label: 'Check'
        };
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Proceed error:', err);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned invalid output. Please try again.' });
    }
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---- START ----
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
