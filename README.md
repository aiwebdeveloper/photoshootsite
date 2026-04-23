# VisionForge Studio

`VisionForge Studio` aik lightweight web-based AI media studio hai jo ChatGPT-style creative workflow ko ek modern dashboard mein laata hai.

## Included

- Smart prompt expansion via Groq
- Image generation form with batch size, styles, aspect ratios, text fidelity, and complex scene hints
- Inpainting / selective edit flow with source image + mask
- Image-to-video animation flow
- Video generation form with 15s, 30s, aur 60s presets
- 360 equirectangular panorama viewer
- Panorama ko rotating video ke tor par record karne ka browser-side helper
- Download buttons for generated media

## Important note

Jo `gsk_...` key configure ki gayi hai woh Groq key hai. Is app mein yeh prompt enhancement aur scene planning ke liye use hoti hai. Native image/video generation ke liye aap ko kisi compatible provider ka API base URL aur key `.env.local` mein add karni hogi.

## Run

```powershell
node server.js
```

Ya simply is file ko run karein:

```text
run-server.bat
```

Photoshoot page direct auto-open karne ke liye:

```text
open-photoshoot.bat
```

Ya silent launcher:

```text
open-photoshoot.vbs
```

Phir browser mein open karein:

```text
http://localhost:3000
```

## Deploy on Vercel

GitHub par yeh files/folders upload kar dein:

- `public/`
- `api/`
- `server.js`
- `package.json`
- `vercel.json`

Vercel mein project import karne ke baad Environment Variables set karein:

- `GROQ_API_KEY`
- `GROQ_MODEL`
- `HF_API_KEY`
- `HF_IMAGE_MODEL`
- `HF_VIDEO_API_KEY`
- `HF_VIDEO_PROVIDER`
- `HF_VIDEO_TEXT_MODEL`
- `HF_VIDEO_IMAGE_MODEL`

Deploy ke baad app direct open hogi:

```text
https://your-project.vercel.app/photoshoot
```

## Environment

- `GROQ_API_KEY`: prompt enhancement ke liye
- `IMAGE_API_BASE_URL`: image generation provider endpoint
- `IMAGE_API_KEY`: image generation provider key
- `IMAGE_MODEL`: optional image model id
- `VIDEO_API_BASE_URL`: video generation provider endpoint
- `VIDEO_API_KEY`: video generation provider key
- `VIDEO_MODEL`: optional video model id

## Expected provider payloads

App generic JSON payload bhejta hai. Image provider ko yeh keys milti hain:

- `prompt`
- `negativePrompt`
- `style`
- `size`
- `count`
- `textFidelity`
- `camera`
- `is360`
- `editImage`
- `maskImage`
- `model`

Video provider ko yeh keys milti hain:

- `prompt`
- `style`
- `duration`
- `shotType`
- `motionStrength`
- `aspectRatio`
- `inputImage`
- `is360`
- `model`

Provider response mein media URLs ya base64 blobs return kiye ja sakte hain. Server common formats ko normalize kar deta hai.
