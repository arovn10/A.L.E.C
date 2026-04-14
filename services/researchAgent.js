/**
 * A.L.E.C. Research Agent
 *
 * Autonomous deep research that runs in the background:
 *  1. Breaks topic into research questions
 *  2. Searches the web for each question
 *  3. Synthesizes findings via LLM
 *  4. Generates a structured report (markdown)
 *  5. Saves to data/reports/ and notifies Alec via iMessage when done
 *
 * Usage:
 *   const job = researchAgent.startResearch('Google Ads optimization for apartment rentals')
 *   // job.id → poll /api/tasks/:id for status, or get iMessage notification
 */

const fs   = require('path');
const path = require('path');
const fsSync = require('fs');
const os   = require('os');

const REPORTS_DIR = path.join(__dirname, '../data/reports');
fsSync.mkdirSync(REPORTS_DIR, { recursive: true });

// Lazy loaders to avoid circular deps
const getLlama    = () => require('./llamaEngine.js');
const getTask     = () => require('./taskScheduler.js');
const getIMessage = () => { try { return require('./iMessageService.js'); } catch { return null; } };

// ── Web search ─────────────────────────────────────────────────────
const BRAVE_KEY    = process.env.BRAVE_API_KEY   || null;
const SEARCH_KEY   = process.env.SEARCH_API_KEY  || null; // Serp API or similar

async function webSearch(query, maxResults = 5) {
  // Try Brave Search API first (richest results)
  if (BRAVE_KEY) {
    try {
      const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, {
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return (data.web?.results || []).map(r => ({
          title:   r.title,
          url:     r.url,
          snippet: r.description?.slice(0, 400) || '',
        }));
      }
    } catch (_) {}
  }

  // DuckDuckGo fallback (no API key needed)
  try {
    const encoded = encodeURIComponent(query);
    const resp = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    const results = [];
    if (data.Abstract)   results.push({ title: data.Heading || 'DuckDuckGo Abstract', url: data.AbstractURL, snippet: data.Abstract });
    if (data.Answer)     results.push({ title: 'Direct Answer', url: data.AbstractURL, snippet: data.Answer });
    (data.RelatedTopics || []).slice(0, maxResults - 1).forEach(t => {
      if (t.Text) results.push({ title: t.Text.slice(0, 60), url: t.FirstURL, snippet: t.Text });
    });
    return results;
  } catch (_) {
    return [];
  }
}

// ── Report builder ─────────────────────────────────────────────────

/**
 * Generate sub-questions for a research topic using the LLM.
 */
async function generateQuestions(topic) {
  const llama = getLlama();
  const response = await llama.generate([
    { role: 'system', content: 'You are a research planning assistant. Generate focused research sub-questions. Return ONLY a JSON array of 4-6 strings, nothing else.' },
    { role: 'user', content: `Topic: "${topic}"\n\nGenerate 4-6 specific research questions that together will give a comprehensive understanding of this topic. Return as JSON array.` },
  ], { maxTokens: 256, temperature: 0.4 });

  try {
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) return JSON.parse(match[0]);
  } catch (_) {}
  return [topic]; // fallback to single search
}

/**
 * Synthesize research findings into a structured report via LLM.
 */
async function synthesizeFindings(topic, allFindings) {
  const llama = getLlama();
  const context = allFindings.map(f =>
    `### Question: ${f.question}\n${f.results.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`
  ).join('\n\n');

  const response = await llama.generate([
    { role: 'system', content: `You are a professional analyst writing a research report for Alec Rovner. Use markdown with clear sections. Be concise, specific, and actionable. Today is ${new Date().toLocaleDateString()}.` },
    { role: 'user', content: `Write a comprehensive research report on: "${topic}"\n\nResearch findings:\n${context.slice(0, 6000)}\n\nStructure: Executive Summary → Key Findings → Detailed Analysis → Recommendations → Next Steps` },
  ], { maxTokens: 2048, temperature: 0.5 });

  return response;
}

// ── Main: startResearch ────────────────────────────────────────────

/**
 * Start a background research task.
 * Returns immediately with a task ID.
 * When done: saves report to data/reports/, notifies Alec via iMessage.
 *
 * @param {string} topic     — research topic or question
 * @param {object} opts      — { notifyWhenDone (bool), saveReport (bool), returnSummary (bool) }
 */
function startResearch(topic, opts = {}) {
  const scheduler = getTask();
  const { notifyWhenDone = true, saveReport = true } = opts;

  return scheduler.runBackground(async (updateProgress) => {
    updateProgress(5, 'Planning research questions…');

    // 1. Break into sub-questions
    const questions = await generateQuestions(topic);
    updateProgress(10, `Generated ${questions.length} research questions`);

    // 2. Search each question
    const allFindings = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      updateProgress(10 + Math.round(i / questions.length * 50), `Researching: "${q.slice(0, 60)}"`);
      const results = await webSearch(q, 5);
      allFindings.push({ question: q, results });
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }

    updateProgress(65, 'Synthesizing findings…');

    // 3. Synthesize
    const report = await synthesizeFindings(topic, allFindings);
    updateProgress(90, 'Saving report…');

    // 4. Save report
    let reportPath = null;
    if (saveReport) {
      const safeTopic = topic.replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50).replace(/\s+/g, '-');
      const fileName  = `report-${safeTopic}-${Date.now()}.md`;
      reportPath = require('path').join(REPORTS_DIR, fileName);
      const fullReport = [
        `# Research Report: ${topic}`,
        `*Generated by A.L.E.C. on ${new Date().toLocaleString()}*`,
        '',
        `**Research Questions:**`,
        questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
        '',
        '---',
        '',
        report,
        '',
        '---',
        `*Report saved: ${new Date().toISOString()}*`,
      ].join('\n');
      require('fs').writeFileSync(reportPath, fullReport, 'utf8');
    }

    updateProgress(100, 'Research complete');

    // 5. Notify via iMessage
    if (notifyWhenDone) {
      const im = getIMessage();
      if (im) {
        const summary = report.split('\n').find(l => l.trim().startsWith('#') || l.length > 50) || report.slice(0, 150);
        await im.notifyOwner(`Research on "${topic.slice(0, 60)}" is ready!\n\nKey finding: ${summary.slice(0, 200)}\n\nFull report saved to ALEC.`, '📚 Research Done');
      }
    }

    return {
      topic,
      questions,
      reportPath,
      reportPreview: report.slice(0, 500),
      sources: allFindings.flatMap(f => f.results.slice(0, 2).map(r => r.url)).filter(Boolean).slice(0, 10),
    };
  }, { description: `Research: ${topic.slice(0, 60)}`, notifyWhenDone: false }); // iMessage handled above
}

// ── Quick in-line research (blocking) ─────────────────────────────

/**
 * Run research synchronously (for chat responses).
 * Limited to 3 questions to keep latency under control.
 */
async function quickResearch(topic, maxQuestions = 3) {
  const questions = (await generateQuestions(topic)).slice(0, maxQuestions);
  const allFindings = [];
  for (const q of questions) {
    const results = await webSearch(q, 4);
    allFindings.push({ question: q, results });
  }
  return synthesizeFindings(topic, allFindings);
}

// ── List saved reports ─────────────────────────────────────────────
function listReports() {
  try {
    return require('fs').readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = require('fs').statSync(require('path').join(REPORTS_DIR, f));
        return { name: f, path: `/reports/${f}`, sizeKB: Math.round(stat.size / 1024), modified: stat.mtime };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch { return []; }
}

function getReport(fileName) {
  const filePath = require('path').join(REPORTS_DIR, fileName.replace(/\.\./g, ''));
  if (!require('fs').existsSync(filePath)) throw new Error('Report not found');
  return require('fs').readFileSync(filePath, 'utf8');
}

module.exports = { startResearch, quickResearch, listReports, getReport, webSearch };
