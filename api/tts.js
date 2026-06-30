/**
 * Vercel Serverless Function: /api/tts
 *
 * Proxies Google Translate TTS requests server-side so the browser
 * never directly contacts translate.google.com (which blocks requests
 * from browser origins due to CORS / Referer restrictions).
 *
 * Query params:
 *   tl  - target language  (e.g. "en-IN" for Indian English, "ml" for Malayalam)
 *   q   - text to speak    (URL-encoded)
 *
 * Returns: audio/mpeg stream from Google TTS
 */
export default async function handler(req, res) {
  const { tl, q } = req.query

  if (!tl || !q) {
    return res.status(400).json({ error: 'Missing required params: tl, q' })
  }

  // Build Google TTS URL — this call is server→server, no browser Referer sent
  const ttsUrl = new URL('https://translate.google.com/translate_tts')
  ttsUrl.searchParams.set('ie', 'UTF-8')
  ttsUrl.searchParams.set('tl', tl)
  ttsUrl.searchParams.set('client', 'tw-ob')
  ttsUrl.searchParams.set('q', q)

  try {
    const upstream = await fetch(ttsUrl.toString(), {
      headers: {
        // Mimic a real browser so Google serves the audio
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: `Google TTS returned HTTP ${upstream.status}` })
    }

    const audioBuffer = await upstream.arrayBuffer()

    // Cache for 24 hours on Vercel's CDN — same text always sounds the same
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'audio/mpeg')
    res.setHeader('Content-Length', audioBuffer.byteLength)
    // Allow the browser to play it
    res.setHeader('Access-Control-Allow-Origin', '*')

    return res.status(200).send(Buffer.from(audioBuffer))
  } catch (err) {
    console.error('[api/tts] Upstream fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
