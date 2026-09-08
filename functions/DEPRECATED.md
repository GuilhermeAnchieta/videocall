# No longer used

This folder (Firebase Cloud Functions) was replaced by the Netlify Functions in
`../netlify/functions/` — same logic (`generateLiveKitToken` -> `generate-livekit-token.mts`,
`createRoom` -> `create-room.mts`), just running for free (Netlify Functions doesn't require
Firebase's paid Blaze plan, which Cloud Functions requires even without exceeding the free usage
tier).

This folder can be safely deleted. It's kept here only for reference.
