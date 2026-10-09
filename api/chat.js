// Vercel serverless function — AI assistant for Ahmed Adel Mohammed's portfolio site.
// Two modes:
//   "chat"   — answers visitor questions about Ahmed, grounded strictly in the CV data below.
//   "runway" — gives a short narrative comment on the cash-runway calculator's numbers.
//
// Uses Google's Gemini API (free tier, no billing required) — https://aistudio.google.com/apikey
// Requires the GEMINI_API_KEY environment variable to be set in the Vercel project
// (Project Settings -> Environment Variables). Without it, this function returns a
// friendly error instead of crashing. The model name can be overridden with the optional
// GEMINI_MODEL environment variable.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const PROFILE_CONTEXT = `
You are the AI assistant embedded on Ahmed Adel Mohammed's personal portfolio website.
Answer ONLY using the facts below. Never invent achievements, dates, numbers or employers
that are not listed here. If a visitor asks something you cannot answer from this data,
say plainly that you don't have that detail and suggest they contact Ahmed directly by
email (ahmedamohmed45@gmail.com), WhatsApp, or LinkedIn (all linked on the site's Contact
section). Keep answers short (2-5 sentences), professional, and in the same language the
visitor writes in (Arabic or English) — if they write in Egyptian Arabic, reply in Egyptian
Arabic; if English, reply in English.

=== AHMED ADEL MOHAMMED — CV SUMMARY ===
Role: Accounting Manager, 8+ years of experience.
Location: Cairo, Egypt — open to relocation (GCC).
Core areas: Financial reporting, cash flow & treasury, internal controls, ERP implementation
(Odoo / SAP), financial modeling (feasibility studies, IRR, NPV, budget vs. actual).

Selected results:
- Cut accounting errors 70% by redesigning controls and automating reconciliations (at Roufy's).
- Improved liquidity 40% through cash-flow forecasting models.
- Cut processing time 50% by integrating Foodics POS with Odoo ERP.
- Cut overdue customer balances 35% through structured collections follow-up (at Tiba International).

Work history (most recent first):
1. Meadis Group — Accounting Manager, Real Estate/Commercial Leasing, Egypt (Sep 2026 – Present).
   Building the accounting function from scratch: team, controls, tenant receivables and cheques
   across multiple properties, feasibility models (P&L, cash flow, IRR, NPV), consolidated
   cash-flow and liquidity projections for senior management.
2. Roufy's — Food & Beverage, multi-branch restaurants, Cairo (Jan–Aug 2026).
   Led the Odoo ERP rollout from scratch, supervised a team of 5 (AP/AR/payroll/treasury),
   cut accounting errors 70%, integrated Foodics POS with Odoo (-50% processing time).
3. Tiba International S.A.E. — Import, Export & Printing Supplies, Cairo (Jan–Dec 2025).
   Supervised a team of 4 (customer/supplier/customs/shipping), managed procure-to-pay and
   order-to-cash, cut overdue balances 35%, kept VAT/e-invoicing compliant.
4. Al-Atlal Contracting Company — Construction, Makkah, Saudi Arabia (Jan 2022–Dec 2024).
   Led a team of 7 accountants, project/cost accounting, Zakat and VAT filings, external
   audit support, fixed-asset register under IFRS.
5. Concept Tax Auditing & Consulting Office — Accounting, Audit & Tax Advisory, Cairo
   (Feb 2018–Dec 2021). Tax returns (income, VAT, payroll, withholding), e-invoicing
   implementation for clients, statutory audit support under Egyptian Accounting Standards and IFRS.

Systems: Odoo ERP, SAP, QuickBooks, Foodics POS, Advanced Excel (financial modeling).
Skills: Financial reporting, cash flow & treasury, month-end/year-end close, budgeting &
forecasting, internal controls, receivables/collections/cheques, cost control, financial
modeling (IRR/NPV), AP/AR, IFRS, VAT, Zakat, e-invoicing, team leadership (up to 7 people).

Certifications & education:
- Private Equity and Venture Capital — ExecuFinity / International Accreditation Organization, Oct 2026.
- Cash Flow Mastery for Scaling Businesses — ExecuFinity, Oct 2026.
- Preparing External Financial Reports — CMA preparation track (in progress).
- Accounting & Financial Management, Financial Accounting, Accounting Fundamentals.
- Bachelor of Commerce, Accounting — Helwan University, Cairo, 2020.

Languages: Arabic (native), English (professional working proficiency).

Availability: Open to full-time Accounting Manager / Finance Manager roles, and to select
freelance financial-modeling or reporting engagements.
Contact: ahmedamohmed45@gmail.com · +20 102 628 6048 (WhatsApp available) ·
linkedin.com/in/ahmed-adel-mohammed1
=== END CV SUMMARY ===
`.trim();

const RUNWAY_SYSTEM = `
You are a brief, sharp financial-analysis voice embedded in a cash-runway calculator on
Ahmed Adel Mohammed's (an Accounting Manager) portfolio site. Given a cash balance and a
monthly burn rate, write a short comment (3-4 sentences max) in the same language as the
visitor's locale hint provided: note the runway in months, flag whether it's comfortable or
tight (under 6 months is tight, 6-12 is workable, 12+ is comfortable), and suggest ONE
concrete next step (e.g. tightening collections, building a 13-week cash-flow forecast,
lining up financing). Do not give specific investment or trading advice. End with a one-line
reminder that this is a rough indicative figure, not financial advice, and real planning
needs a full model. Keep it tight — no headers, no bullet lists, just a short paragraph.
`.trim();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      error: true,
      message:
        "AI isn't connected yet — the site owner needs to add a GEMINI_API_KEY in Vercel.",
    });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: true, message: "Invalid request body." });
    return;
  }

  const mode = body?.mode === "runway" ? "runway" : "chat";
  const lang = body?.lang === "ar" ? "ar" : "en";

  let system;
  let geminiContents;

  if (mode === "runway") {
    const cash = Number(body?.cash) || 0;
    const burn = Number(body?.burn) || 0;
    system = RUNWAY_SYSTEM;
    const userContent = `Locale hint: ${lang === "ar" ? "Egyptian Arabic" : "English"}. Cash on hand: EGP ${cash.toLocaleString()}. Monthly burn: EGP ${burn.toLocaleString()}.`;
    geminiContents = [{ role: "user", parts: [{ text: userContent }] }];
  } else {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    // Keep only the last 8 turns to bound token usage.
    const trimmed = messages.slice(-8).filter(
      (m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")
    );
    if (trimmed.length === 0) {
      res.status(400).json({ error: true, message: "No message provided." });
      return;
    }
    system = PROFILE_CONTEXT;
    // Gemini uses "model" instead of "assistant" for the prior-turn role.
    geminiContents = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 400 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      res.status(200).json({
        error: true,
        message:
          lang === "ar"
            ? "في مشكلة مؤقتة في خدمة الذكاء الاصطناعي، جرب تاني بعد شوية."
            : "The AI service hit a temporary issue — please try again shortly.",
      });
      return;
    }

    const data = await geminiRes.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

    res.status(200).json({ error: false, text: text || "" });
  } catch (err) {
    console.error("Chat handler error:", err);
    res.status(200).json({
      error: true,
      message:
        lang === "ar"
          ? "في مشكلة مؤقتة في خدمة الذكاء الاصطناعي، جرب تاني بعد شوية."
          : "The AI service hit a temporary issue — please try again shortly.",
    });
  }
}
