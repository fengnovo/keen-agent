This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

From the `keen-agent` repository root, start the chat app and Nest AI server together:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses the self-hosted [`geist`](https://vercel.com/font) package, so builds do not depend on Google Fonts.

## Model management

Use the **模型管理** button at the bottom of the sidebar to create, read, update, delete, or activate AI Agent model configurations. The UI calls the Nest service through `/api/ai-server/*`.

Chat requests, conversation history, and per-conversation model selection also use the Nest service. Conversations are restored after a page refresh instead of relying on browser-only demo data.

The chat composer supports vision input through image selection, drag-and-drop, and clipboard paste. JPEG, PNG, GIF, and WebP images are accepted, with up to 3 images per request, 4 MB per image, and 6 MB total. Images are validated again by the Nest service, persisted with the conversation, and restored in message history. When the selected chat model cannot read images, the Nest service first uses its configured vision model (default: `qwen3.5-ocr`) and then passes the extracted visual context to the selected model for the final answer and future follow-up questions.

The proxy defaults to `http://127.0.0.1:3001`. To use a different Nest service, add this to `ai-chat/.env.local`:

```bash
AI_SERVER_URL=http://127.0.0.1:3001
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
