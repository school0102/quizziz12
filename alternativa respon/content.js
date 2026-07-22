(() => {
  "use strict";

  const GEMINI_API_KEY = "";
  const PRIMARY_MODEL = "gemini-3.1-flash-lite";
  const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  const BUTTON_ID = "__eyes_ai_button__";
  const CHECK_INTERVAL_MS = 3500;

  function isVisible(el) {
    if (!el || el.id === BUTTON_ID) return false;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && 
           parseFloat(style.opacity) > 0.1 && r.width > 30 && r.height > 20;
  }

  function getQuestionData() {
    // Captura o enunciado da pergunta
    let question = document.querySelector('h1, h2, [class*="question"], [class*="prompt"], [data-testid*="question"]')?.textContent?.trim() || "";
    
    if (!question) {
      const texts = [...document.querySelectorAll("p, div, span")]
        .filter(el => el.textContent.trim().length > 40 && el.textContent.trim().length < 800)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      question = texts[0]?.textContent.trim() || "Pergunta não detectada";
    }

    // Detecta se é do tipo "Select answer" (Verdadeiro/Falso)
    const statements = [...document.querySelectorAll("div")]
      .filter(c => c.textContent.toLowerCase().includes("select answer"))
      .map(container => ({
        container,
        text: container.textContent.replace(/Select answer.*|Selecionar resposta.*/i, '').trim()
      }))
      .filter(s => s.text.length > 30);

    if (statements.length > 0) {
      return { type: "truefalse", question, statements };
    }

    // Múltipla escolha normal
    const options = [...document.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .filter(el => {
        const t = el.textContent.trim();
        return t.length > 5 && !/^(next|submit|continue|skip)/i.test(t);
      })
      .map(el => el.textContent.trim());

    return { type: "multiple", question, options };
  }

  function buildPrompt(data) {
    const optionLines = data.type === "truefalse" 
      ? data.statements.map((s, i) => `${i+1}. ${s.text}`).join("\n")
      : data.options.map((o, i) => `${i+1}. ${o}`).join("\n");

    return [
      "Você é um tutor escolar em português do Brasil.",
      "VOCE DEVE SEGUIR EXATAMENTE ESTE FORMATO DE RESPOSTA!",
      "Analise a questao e decida que tipo de questao é e com base nisso responda com o numero proposto. LEMBRE SE DE QUE DEVE SER TUDO EM 1 LINHA SUAS RESPOSTAS! APOS RESPONDER O NUMERO PROPOSTO, COLOQUE UM ':' E DE ESPACO ANTES DE PROSSEGUIR!",
      "Questao de 1 alternativa correta:  1",
      "Questao de multiplas alternativas corretas:  2",
      "Questao de verdadeiro ou falso:  3",
      "Agora, vamos aos formatos de resposta:",
      "Se o numero escolhido foi 1:",
      "Verifique quantas alternativas ha na questao e decida uma resposta, se a correta for a 1, responda com 1, se foi a 2, responda com 2, e assim sucessivamente.",
      "Se o numero escolhido foi 2:",
      "Verifique quantas alternativas ha na questao e decida quantas respostas forem propostas ou necessarias adentro da questao, se a correta for 1, 2, responda com 1, 2, se for 3, 4, responda com 3, 4, e assim sucessivamente.",
      "Se o numero escolhido foi 3:",
      "Verifique quantas frases devem ser respondidas, e responda os numeros nesse formato:  Use 1 para verdadeiro e 2 para falso, se a 1 frase for verdadeira, responda assim: 1. 1, se a 3 frase for verdadeira, responda assim: 3. 1, e assim sucessivamente ate completar as necessarias.",
      "REVISE SUA RESPOSTA ANTES DE ENVIA-LA, SE ESTIVER ERRADO REFACA DENOVO E COLOQUE AS RESPOSTAS CERTAS!",
      "",
      `PERGUNTA:\n${data.question}`,
      "",
      `ALTERNATIVAS:\n${optionLines}`
    ].join("\n");
  }

  async function callGemini(prompt) {
    const response = await fetch(`${API_BASE}/${PRIMARY_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 250 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Erro ${response.status}`);
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }

async function clickAnswerByNumber(num) {
  const answers = [...document.querySelectorAll("button, [role='button']")]
    .filter(isVisible)
    .filter(el => {
      const t = el.textContent.trim().toLowerCase();
      return t.length > 0 &&
        !/^(next|submit|continue|skip|config|settings|menu|options)$/i.test(t);
    });

  if (num < 1 || num > answers.length) return false;

  const target = answers[num - 1];
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  await new Promise(r => setTimeout(r, 350));
  target.click();
  await new Promise(r => setTimeout(r, 900));
  return true;
}

function parseGeminiResponse(text) {
  const cleaned = text.trim();
  const typeMatch = cleaned.match(/^([1-3])\s*[:.-]?\s*(.*)$/s);
  if (!typeMatch) return null;

  const type = parseInt(typeMatch[1], 10);
  const rest = typeMatch[2].trim();

  if (type === 1) {
    const m = rest.match(/\b([1-8])\b/);
    return { type, answers: m ? [parseInt(m[1], 10)] : [] };
  }

  if (type === 2) {
    const nums = [...rest.matchAll(/\b([1-8])\b/g)].map(m => parseInt(m[1], 10));
    return { type, answers: [...new Set(nums)] };
  }

  if (type === 3) {
    const items = [...rest.matchAll(/(\d+)\s*\.\s*([12])/g)].map(m => ({
      index: parseInt(m[1], 10),
      value: parseInt(m[2], 10)
    }));
    return { type, vf: items };
  }

  return null;
}

async function handleEyeClick() {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  button.style.transform = "translateX(-50%) scale(0.75)";
  button.style.opacity = "0.6";

  try {
    const data = getQuestionData();
    const prompt = buildPrompt(data);
    const responseText = await callGemini(prompt);

    console.log("[IA Resposta]:", responseText);

    const parsed = parseGeminiResponse(responseText);
    if (!parsed) {
      alert("Resposta inválida da IA.");
      return;
    }

    if (parsed.type === 1) {
      if (parsed.answers.length < 1) {
        alert("Não foi possível identificar a alternativa correta.");
        return;
      }
      await clickAnswerByNumber(parsed.answers[0]);
    }

    if (parsed.type === 2) {
      if (parsed.answers.length < 1) {
        alert("Não foi possível identificar as alternativas corretas.");
        return;
      }
      for (const num of parsed.answers) {
        await clickAnswerByNumber(num);
      }
    }

    if (parsed.type === 3) {
      console.log("VF interpretado:", parsed.vf);
      alert("Questão de verdadeiro/falso: implemente aqui o clique correspondente no site.");
    }

  } catch (err) {
    console.error(err);
    alert("Erro: " + err.message);
  } finally {
    setTimeout(() => {
      button.style.transform = "translateX(-50%)";
      button.style.opacity = "1";
    }, 600);
  }
}

  function createButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "👀";
    button.title = "IA Responder";

    Object.assign(button.style, {
      position: "fixed",
      left: "50%",
      bottom: "25px",
      transform: "translateX(-50%)",
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      background: "rgba(20, 20, 25, 0.96)",
      border: "3px solid white",
      color: "white",
      fontSize: "34px",
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
      zIndex: "2147483647",
      boxShadow: "0 10px 35px rgba(0,0,0,0.6)",
      transition: "all 0.25s ease"
    });

    button.addEventListener("click", handleEyeClick);
    document.body.appendChild(button);
  }

  function init() {
    createButton();
    setInterval(createButton, CHECK_INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();