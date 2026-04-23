const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { InferenceClient } = require("@huggingface/inference");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const execFileAsync = promisify(execFile);

loadEnv(path.join(rootDir, ".env.local"));

const PORT = Number(process.env.PORT || 3000);
const GENERATED_DIR = path.join(rootDir, "generated");

if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, requestUrl);
    } catch (error) {
      respondJson(res, 500, {
        error: error.message || "Unexpected server error",
      });
    }
    return;
  }

  serveStatic(req, res, requestUrl.pathname);
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`VisionForge Studio running at http://localhost:${PORT}`);
  });
}

async function handleApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    const imageMode = getImageMode();
    const videoMode = getVideoMode();
    return respondJson(res, 200, {
      groqEnabled: Boolean(process.env.GROQ_API_KEY),
      imageEnabled: imageMode !== "disabled",
      videoEnabled: videoMode === "custom-provider",
      imageMode,
      videoMode,
      defaults: {
        imageModel: process.env.IMAGE_MODEL || process.env.HF_IMAGE_MODEL || "",
        videoModel: process.env.VIDEO_MODEL || "",
      },
    });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/enhance") {
    const body = await readJson(req);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return respondJson(res, 400, { error: "Prompt is required." });
    }

    if (!process.env.GROQ_API_KEY) {
      return respondJson(res, 200, {
        prompt,
        expandedPrompt: fallbackExpansion(body),
        provider: "local-fallback",
      });
    }

    const enhanced = await enhanceWithGroq(body);
    return respondJson(res, 200, enhanced);
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/generate-image") {
    const body = await readJson(req);
    if (!body.prompt) {
      return respondJson(res, 400, { error: "Prompt is required for image generation." });
    }
    const imageMode = getImageMode();
    if ((imageMode === "pollinations-free" || imageMode === "huggingface") && (body.editImage || body.maskImage)) {
      return respondJson(res, 400, {
        error:
          "Current image mode text-to-image tak limited hai. Inpainting ke liye custom image provider configure karein.",
      });
    }
    if (imageMode === "huggingface") {
      return respondJson(res, 200, {
        media: await buildHuggingFaceImages(body),
        mode: "huggingface",
      });
    }
    if (imageMode === "pollinations-free") {
      return respondJson(res, 200, {
        media: buildPollinationsImages(body),
        mode: "pollinations-free",
      });
    }

    const result = await callMediaProvider({
      baseUrl: process.env.IMAGE_API_BASE_URL,
      apiKey: process.env.IMAGE_API_KEY,
      payload: {
        prompt: body.prompt,
        negativePrompt: body.negativePrompt || "",
        style: body.style || "photorealistic",
        size: body.size || "1024x1024",
        count: Number(body.count || 1),
        textFidelity: body.textFidelity || "high",
        camera: body.camera || "natural",
        is360: Boolean(body.is360),
        editImage: body.editImage || null,
        maskImage: body.maskImage || null,
        model: body.model || process.env.IMAGE_MODEL || "",
      },
    });

    return respondJson(res, 200, {
      media: normalizeProviderMedia(result, "image"),
      raw: result,
    });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/generate-video") {
    const body = await readJson(req);
    if (!body.prompt && !body.inputImage) {
      return respondJson(res, 400, {
        error: "Prompt ya input image zaroori hai for video generation.",
      });
    }
    if (getVideoMode() === "local-animation") {
      if (!body.inputImage) {
        return respondJson(res, 400, {
          error:
            "Free mode mein direct text-to-video available nahi hai. Pehle image generate/upload karein, phir usay animate karein.",
        });
      }

      return respondJson(res, 200, {
        mode: "local-animation",
        localAnimation: {
          inputImage: body.inputImage,
          prompt: body.prompt || "",
          style: body.style || "cinematic",
          duration: Number(body.duration || 15),
          shotType: body.shotType || "cinematic",
          motionStrength: body.motionStrength || "medium",
          aspectRatio: body.aspectRatio || "16:9",
        },
      });
    }

    if (getVideoMode() === "huggingface-video") {
      try {
        const media = await buildHuggingFaceVideo(body);
        return respondJson(res, 200, {
          media,
          mode: "huggingface-video",
        });
      } catch (error) {
        const message = error.message || "Hugging Face video generation failed.";
        const creditsBlocked =
          message.includes("depleted your monthly included credits") ||
          message.toLowerCase().includes("purchase pre-paid credits");

        if (creditsBlocked && body.inputImage) {
          return respondJson(res, 200, {
            mode: "local-animation",
            warning:
              "Hugging Face video credits depleted lag rahi hain, is liye local animation fallback use ki gayi hai.",
            localAnimation: {
              inputImage: body.inputImage,
              prompt: body.prompt || "",
              style: body.style || "cinematic",
              duration: Number(body.duration || 15),
              shotType: body.shotType || "cinematic",
              motionStrength: body.motionStrength || "medium",
              aspectRatio: body.aspectRatio || "16:9",
            },
          });
        }

        throw error;
      }
    }

    const result = await callMediaProvider({
      baseUrl: process.env.VIDEO_API_BASE_URL,
      apiKey: process.env.VIDEO_API_KEY,
      payload: {
        prompt: body.prompt || "",
        style: body.style || "cinematic",
        duration: Number(body.duration || 15),
        shotType: body.shotType || "cinematic",
        motionStrength: body.motionStrength || "medium",
        aspectRatio: body.aspectRatio || "16:9",
        inputImage: body.inputImage || null,
        is360: Boolean(body.is360),
        model: body.model || process.env.VIDEO_MODEL || "",
      },
    });

    return respondJson(res, 200, {
      media: normalizeProviderMedia(result, "video"),
      raw: result,
    });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/export-mp4") {
    const body = await readJson(req);
    if (!body.videoDataUrl) {
      return respondJson(res, 400, { error: "videoDataUrl is required." });
    }

    const ffmpegAvailable = await hasFfmpeg();
    if (!ffmpegAvailable) {
      return respondJson(res, 400, {
        error: "FFmpeg system par installed nahi mila. Abhi WebM download use karein.",
      });
    }

    const output = await convertWebmDataUrlToMp4(body.videoDataUrl);
    return respondJson(res, 200, {
      videoUrl: output,
    });
  }

  respondJson(res, 404, { error: "Route not found." });
}

function serveStatic(req, res, pathname) {
  const normalizedPath =
    pathname === "/mywebpage" || pathname === "/mywebpage/" || pathname === "/photoshoot" || pathname === "/photoshoot/"
      ? "/"
      : pathname;
  const cleanPath = normalizedPath === "/" ? "/index.html" : normalizedPath;
  const targetPath = path.normalize(path.join(publicDir, cleanPath));
  if (!targetPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(targetPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": getContentType(targetPath),
    });
    res.end(data);
  });
}

async function enhanceWithGroq(input) {
  const systemPrompt =
    "You are a cinematic prompt engineer for image and video generation. Convert short user prompts into rich, production-ready prompts with strong subject detail, lighting, composition, camera, motion, texture, typography accuracy, environment detail, and mood. Preserve the original idea. Mention readable text exactly when relevant. Return JSON with keys expandedPrompt, negativePrompt, shotNotes, textInstructions.";

  const userPrompt = JSON.stringify({
    originalPrompt: input.prompt,
    medium: input.medium || "image",
    style: input.style || "",
    camera: input.camera || "",
    wantsText: input.wantsText || false,
    duration: input.duration || null,
    is360: Boolean(input.is360),
    count: Number(input.count || 1),
  });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq enhance failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");

  return {
    prompt: input.prompt,
    expandedPrompt: parsed.expandedPrompt || fallbackExpansion(input),
    negativePrompt:
      parsed.negativePrompt ||
      "blurry, low detail, distorted anatomy, bad perspective, unreadable text, watermark, extra limbs",
    shotNotes: parsed.shotNotes || "",
    textInstructions: parsed.textInstructions || "",
    provider: "groq",
  };
}

async function callMediaProvider({ baseUrl, apiKey, payload }) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `Provider error (${response.status})`);
  }

  return data;
}

function normalizeProviderMedia(result, mediaType) {
  const candidates = [];
  const collections = [
    result.media,
    result.data,
    result.images,
    result.videos,
    result.outputs,
    result.results,
  ].filter(Boolean);

  for (const collection of collections) {
    if (Array.isArray(collection)) {
      for (const item of collection) {
        candidates.push(item);
      }
    } else {
      candidates.push(collection);
    }
  }

  if (!candidates.length) {
    if (typeof result.url === "string") {
      return [{ type: mediaType, url: result.url }];
    }
    if (typeof result.b64_json === "string") {
      return [{
        type: mediaType,
        url: `data:${mediaType === "image" ? "image/png" : "video/mp4"};base64,${result.b64_json}`,
      }];
    }
  }

  return candidates
    .map((item) => {
      if (typeof item === "string") {
        return { type: mediaType, url: item };
      }
      if (item?.url) {
        return { type: mediaType, url: item.url };
      }
      if (item?.b64_json) {
        return {
          type: mediaType,
          url: `data:${mediaType === "image" ? "image/png" : "video/mp4"};base64,${item.b64_json}`,
        };
      }
      if (item?.base64) {
        return {
          type: mediaType,
          url: `data:${mediaType === "image" ? "image/png" : "video/mp4"};base64,${item.base64}`,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function fallbackExpansion(input) {
  const style = input.style ? `${input.style} style` : "high-end cinematic style";
  const camera = input.camera ? `${input.camera} camera treatment` : "DSLR realism";
  const medium = input.medium === "video" ? "video scene" : "image scene";
  const panorama = input.is360 ? "360 equirectangular panoramic composition" : "";
  return `${input.prompt}, ${medium}, ${style}, ${camera}, highly detailed subject, clean composition, realistic lighting, rich textures, carefully designed background, accurate typography where text appears, premium production quality ${panorama}`.trim();
}

function getImageMode() {
  if (process.env.IMAGE_API_BASE_URL && process.env.IMAGE_API_KEY) {
    return "custom-provider";
  }
  if (process.env.HF_API_KEY) {
    return "huggingface";
  }
  return "pollinations-free";
}

function getVideoMode() {
  if (process.env.VIDEO_API_BASE_URL && process.env.VIDEO_API_KEY) {
    return "custom-provider";
  }
  if (process.env.HF_VIDEO_API_KEY) {
    return "huggingface-video";
  }
  return "local-animation";
}

async function hasFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function buildHuggingFaceImages(input) {
  const size = String(input.size || "1024x1024");
  const [widthText, heightText] = size.split("x");
  const width = Number(widthText) || 1024;
  const height = Number(heightText) || 1024;
  const count = Math.max(1, Math.min(Number(input.count || 1), 4));
  const model = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const media = [];

  for (let index = 0; index < count; index += 1) {
    const seed = Date.now() + index * 101;
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: input.prompt,
          parameters: {
            negative_prompt: input.negativePrompt || "",
            width,
            height,
            seed,
            num_inference_steps: 28,
            guidance_scale: 7.5,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hugging Face image generation failed: ${response.status} ${errorText}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    media.push({
      type: "image",
      url: `data:${contentType};base64,${base64}`,
    });
  }

  return media;
}

async function buildHuggingFaceVideo(input) {
  const client = new InferenceClient(process.env.HF_VIDEO_API_KEY);
  const provider = process.env.HF_VIDEO_PROVIDER || "fal-ai";

  if (input.inputImage) {
    const imageBlob = dataUrlToBlob(input.inputImage);
    const result = await client.imageToVideo({
      provider,
      model: process.env.HF_VIDEO_IMAGE_MODEL || "Wan-AI/Wan2.1-I2V-14B-720P",
      inputs: imageBlob,
      parameters: {
        prompt: input.prompt || "Create a smooth cinematic motion shot",
      },
    });

    return [await blobToMediaUrl(result, "video/mp4")];
  }

  const result = await client.textToVideo({
    provider,
    model: process.env.HF_VIDEO_TEXT_MODEL || "genmo/mochi-1-preview",
    inputs: input.prompt || "A cinematic atmospheric scene",
  });

  return [await blobToMediaUrl(result, "video/mp4")];
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL.");
  }
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}

async function blobToMediaUrl(blob, fallbackMime) {
  const arrayBuffer = await blob.arrayBuffer();
  const mime = blob.type || fallbackMime;
  return {
    type: mime.startsWith("video/") ? "video" : "image",
    url: `data:${mime};base64,${Buffer.from(arrayBuffer).toString("base64")}`,
  };
}

async function convertWebmDataUrlToMp4(videoDataUrl) {
  const match = String(videoDataUrl).match(/^data:video\/webm;base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid WebM data URL.");
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const inputPath = path.join(GENERATED_DIR, `${id}.webm`);
  const outputPath = path.join(GENERATED_DIR, `${id}.mp4`);

  fs.writeFileSync(inputPath, Buffer.from(match[1], "base64"));

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
  }

  const mp4Buffer = fs.readFileSync(outputPath);
  fs.unlinkSync(outputPath);
  return `data:video/mp4;base64,${mp4Buffer.toString("base64")}`;
}

function buildPollinationsImages(input) {
  const size = String(input.size || "1024x1024");
  const [widthText, heightText] = size.split("x");
  const width = Number(widthText) || 1024;
  const height = Number(heightText) || 1024;
  const count = Math.max(1, Math.min(Number(input.count || 1), 8));
  const model = mapImageModel(input.style);
  const negative = input.negativePrompt ? ` negative:${input.negativePrompt}` : "";
  const basePrompt = `${input.prompt}${negative}`;

  return Array.from({ length: count }, (_, index) => {
    const seed = Date.now() + index * 97;
    const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(basePrompt)}`);
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    url.searchParams.set("seed", String(seed));
    url.searchParams.set("model", model);
    url.searchParams.set("nologo", "true");
    url.searchParams.set("enhance", "true");
    return {
      type: "image",
      url: url.toString(),
    };
  });
}

function mapImageModel(style) {
  const normalized = String(style || "").toLowerCase();
  if (normalized.includes("anime") || normalized.includes("comic")) {
    return "seedream";
  }
  if (normalized.includes("product") || normalized.includes("photoreal") || normalized.includes("cinematic")) {
    return "flux";
  }
  if (normalized.includes("context")) {
    return "kontext";
  }
  return "flux";
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const file = fs.readFileSync(filePath, "utf8");
  for (const line of file.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }
    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim();
    process.env[key] = value;
  }
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON payload."));
      }
    });
    req.on("error", reject);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
    }[ext] || "application/octet-stream"
  );
}

module.exports = {
  handleRequest,
};
