import { useState, useEffect, useRef, useCallback } from 'react'

// Sample text to be read aloud and tracked
const SAMPLE_TEXT = `Artificial intelligence is transforming the way we live and work. From voice assistants that understand natural language to recommendation systems that predict what we want to watch or buy, AI is woven into our daily routines. Machine learning, a core branch of AI, enables computers to learn patterns from data without being explicitly programmed. Deep learning, powered by neural networks, has achieved breakthroughs in image recognition, language translation, and even creative tasks like generating art and music. As these technologies continue to advance, the possibilities seem limitless, but so do the responsibilities that come with building them.`

function App() {
  const [status, setStatus] = useState('idle') // idle | playing | paused
  const [activeIndex, setActiveIndex] = useState(-1)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState('')

  const utterRef = useRef(null)
  const wordsRef = useRef([])

  // Split text into words once
  const words = SAMPLE_TEXT.split(/\s+/)

  const charToWordMap = useRef(null)
  if (!charToWordMap.current) {
    const map = []
    let charPos = 0
    words.forEach((word, i) => {
      for (let c = 0; c < word.length; c++) {
        map[charPos + c] = i
      }
      charPos += word.length + 1
    })
    charToWordMap.current = map
  }

  const loadVoices = () => {
    const available = speechSynthesis.getVoices()
    const english = available.filter(v => v.lang.startsWith('en'))
    setVoices(english.length > 0 ? english : available)
    if (english.length > 0 && !selectedVoice) {
      setSelectedVoice(english[0].name)
    } else if (available.length > 0 && !selectedVoice) {
      setSelectedVoice(available[0].name)
    }
  }

  useEffect(() => {
    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices
    return () => { speechSynthesis.onvoiceschanged = null }
  }, [])

  const stop = useCallback(() => {
    speechSynthesis.cancel()
    setStatus('idle')
    setActiveIndex(-1)
    utterRef.current = null
  }, [])

  const play = useCallback(() => {
    // If paused, resume
    if (status === 'paused') {
      speechSynthesis.resume()
      setStatus('playing')
      return
    }

    // Fresh start
    speechSynthesis.cancel()

    const utter = new SpeechSynthesisUtterance(SAMPLE_TEXT)
    utter.rate = 1

    // Set selected voice
    const voice = speechSynthesis.getVoices().find(v => v.name === selectedVoice)
    if (voice) utter.voice = voice

    // 'boundary' fires for each word boundary with charIndex
    utter.onboundary = (e) => {
      if (e.name === 'word') {
        const wordIdx = charToWordMap.current[e.charIndex]
        if (wordIdx !== undefined) {
          setActiveIndex(wordIdx)
        }
      }
    }

    utter.onend = () => {
      setStatus('idle')
      setActiveIndex(-1)
      utterRef.current = null
    }

    utter.onerror = () => {
      setStatus('idle')
      setActiveIndex(-1)
      utterRef.current = null
    }

    utterRef.current = utter
    speechSynthesis.speak(utter)
    setStatus('playing')
    setActiveIndex(0)
  }, [status, selectedVoice])

  const pause = useCallback(() => {
    speechSynthesis.pause()
    setStatus('paused')
  }, [])


  useEffect(() => {
    return () => speechSynthesis.cancel()
  }, [])

  // Progress percentage
  const progress = activeIndex >= 0 ? ((activeIndex + 1) / words.length) * 100 : 0

  return (
    <>
      <div className="header">
        <h1>Voice Text Tracker</h1>
        <p>Words highlight in sync with the voice-over as it reads the text below.</p>
      </div>

      {voices.length > 0 && (
        <div className="voice-select">
          <label>Voice:</label>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={status !== 'idle'}
          >
            {voices.map(v => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
      )}



      <div className="controls">
        {status === 'playing' ? (
          <button className="btn btn-pause" onClick={pause}>
            Pause
          </button>
        ) : (
          <button className="btn btn-play" onClick={play}>
            {status === 'paused' ? 'Resume' : 'Play'}
          </button>
        )}
        <button
          className="btn btn-stop"
          onClick={stop}
          disabled={status === 'idle'}
        >
          Stop
        </button>
      </div>

      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="text-display">
        {words.map((word, i) => {
          let cls = 'word'
          if (i === activeIndex) cls += ' active'
          else if (activeIndex > 0 && i < activeIndex) cls += ' spoken'
          return (
            <span key={i} className={cls}>
              {word}{' '}
            </span>
          )
        })}
      </div>


      <div className="status">
        <span className={`dot ${status}`} />
        {status === 'idle' && 'Ready'}
        {status === 'playing' && 'Playing...'}
        {status === 'paused' && 'Paused'}
      </div>
    </>
  )
}

export default App
