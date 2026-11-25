import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY || "";
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `Kamu adalah "Teman Cerita", pendamping konseling awal berbasis AI yang hangat, empatik, sabar, dan tidak menghakimi.
Gunakan bahasa Indonesia yang lembut, natural, dan menenangkan.
Tugasmu:
1. Dengarkan dan validasi perasaan pengguna terlebih dahulu sebelum memberi saran.
2. Ajukan pertanyaan terbuka yang ringan untuk membantu pengguna mengurai perasaannya.
3. Jangan mendiagnosis kondisi medis/psikologis.
4. Jawab dengan ringkas (2-4 paragraf pendek) agar nyaman dibaca.`;

// Ambil daftar model Gemini yang benar-benar aktif & mendukung chat untuk API Key ini
async function getAvailableModels() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gagal mengambil daftar model dari Google");

  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes("generateContent") && m.name.includes("gemini"))
    .map(m => m.name.replace("models/", ""))
    .filter(name => !name.includes("embedding") && !name.includes("image") && !name.includes("tts"));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(process.cwd(), "index.html");
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("File index.html tidak ditemukan.");
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        if (!API_KEY) throw new Error("API Key kosong.");

        const { messages } = JSON.parse(body);
        const contents = messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));

        // Prioritaskan model flash terlebih dahulu dari daftar model yang aktif
        const available = await getAvailableModels();
        const sortedModels = [
          ...available.filter(m => m.includes("flash")),
          ...available.filter(m => !m.includes("flash"))
        ];

        let data = null;
        let lastError = "Tidak ada model yang merespons.";

        for (const model of sortedModels) {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents
              })
            }
          );

          data = await response.json();
          if (response.ok && data.candidates) {
            console.log(`Berhasil menggunakan model: ${model}`);
            break;
          }
          lastError = data.error?.message || `Model ${model} gagal merespons`;
        }

        if (!data || !data.candidates) {
          throw new Error(lastError);
        }

        const reply = data.candidates[0].content.parts[0].text;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Halaman tidak ditemukan");
});

server.listen(PORT, () => {
  console.log(`Website konseling aktif di http://localhost:${PORT}`);
});