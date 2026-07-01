import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { STUDY_DATA, GRAMMAR_LECTURE_DATA, GRAMMAR_QUIZ_DATA } from './data'

function App() {
  const [playingParaIdx, setPlayingParaIdx] = useState(-1)
  const [status, setStatus] = useState('idle') // idle | playing | paused
  const [activeWordIndex, setActiveWordIndex] = useState(-1)
  
  const [speechRate, setSpeechRate] = useState(0.95) // Adjustable speech rate
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredVocab, setHoveredVocab] = useState(null) // { paraIdx, word }
  
  // Sequential playback states
  const [playLang, setPlayLang] = useState('en') // 'en' | 'ml'
  const [playIndex, setPlayIndex] = useState(-1) // index of currently playing sentence
  const [playMode, setPlayMode] = useState('idle') // 'paragraph' | 'sentence' | 'explanation' | 'idle'
  const [activeSentenceId, setActiveSentenceId] = useState(null) // Sentence currently playing/selected

  // Quiz states
  const [quizScore, setQuizScore] = useState(0)
  const [currentQuizQuestionIdx, setCurrentQuizQuestionIdx] = useState(0)
  const [selectedQuizOption, setSelectedQuizOption] = useState(null)
  const [isQuizSubmitted, setIsQuizSubmitted] = useState(false)
  const [quizFinished, setQuizFinished] = useState(false)

  // Refs for tracking active playing parameters in callbacks safely
  const activeAudioRef = useRef(null)
  const playModeRef = useRef('idle')
  const playIndexRef = useRef(-1)
  const playLangRef = useRef('en')
  const playingParaIdxRef = useRef(-1)

  useEffect(() => {
    playModeRef.current = playMode
  }, [playMode])

  useEffect(() => {
    playIndexRef.current = playIndex
  }, [playIndex])

  useEffect(() => {
    playLangRef.current = playLang
  }, [playLang])

  useEffect(() => {
    playingParaIdxRef.current = playingParaIdx
  }, [playingParaIdx])

  // Track speech boundaries and fallback simulation timer
  const simulationIntervalRef = useRef(null)
  const playbackStartTimeRef = useRef(0)
  const elapsedTimeRef = useRef(0)
  const msPerWordRef = useRef(0)
  const sentenceWordsRef = useRef([])
  const paragraphWordOffsetRef = useRef(0)

  // Tokenize all paragraphs and calculate exact character ranges for each word
  const paragraphsWordRanges = useMemo(() => {
    return STUDY_DATA.map(para => {
      const ranges = []
      const regex = /\S+/g
      let match
      while ((match = regex.exec(para.englishText)) !== null) {
        ranges.push({
          text: match[0],
          start: match.index,
          end: regex.lastIndex
        })
      }
      return ranges
    })
  }, [])

  // Get list of word strings for rendering each paragraph
  const paragraphsWords = useMemo(() => {
    return paragraphsWordRanges.map(ranges => ranges.map(w => w.text))
  }, [paragraphsWordRanges])

  // Helper to normalize strings for comparison (remove punctuation, lower case)
  const cleanWord = (word) => {
    return word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim()
  }

  // Find if a word matches any vocabulary term in a specific paragraph
  const getMatchingVocab = useCallback((paraIdx, wordStr) => {
    if (!wordStr) return null
    const cleaned = cleanWord(wordStr)
    const para = STUDY_DATA[paraIdx]
    if (!para) return null
    return para.vocabulary.find(v => {
      const vCleaned = v.word.toLowerCase()
      return vCleaned === cleaned || vCleaned.includes(cleaned)
    })
  }, [])

  // Helper to split text into chunks under 150 characters for safe Google TTS API queries
  const splitTextIntoChunks = useCallback((text, maxLen = 150) => {
    const sentences = text.match(/[^.!?]+[.!?]*|.+/g) || [text];
    const chunks = [];
    let currentChunk = "";

    for (let sentence of sentences) {
      sentence = sentence.trim();
      if (!sentence) continue;

      if ((currentChunk + " " + sentence).length <= maxLen) {
        currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        if (sentence.length <= maxLen) {
          currentChunk = sentence;
        } else {
          const words = sentence.split(/\s+/);
          currentChunk = "";
          for (let word of words) {
            if ((currentChunk + " " + word).length <= maxLen) {
              currentChunk = currentChunk ? currentChunk + " " + word : word;
            } else {
              chunks.push(currentChunk);
              currentChunk = word;
            }
          }
        }
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    return chunks;
  }, [])

  // Object URL cleanup ref so we can revoke blob URLs and prevent memory leaks
  const objectUrlsRef = useRef([])

  // Revoke all outstanding blob object URLs
  const revokeObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
    objectUrlsRef.current = []
  }, [])

  // Stop any playing speech and clear simulation timers
  const stop = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
      activeAudioRef.current.onended = null
      activeAudioRef.current.onerror = null
      activeAudioRef.current.onloadedmetadata = null
      activeAudioRef.current.onplay = null
      activeAudioRef.current = null
    }
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }
    revokeObjectUrls()
    setStatus('idle')
    setActiveWordIndex(-1)
    setActiveSentenceId(null)
    setPlayIndex(-1)
    setPlayMode('idle')
    setPlayingParaIdx(-1)
    elapsedTimeRef.current = 0
    msPerWordRef.current = 0
    sentenceWordsRef.current = []
    paragraphWordOffsetRef.current = 0
  }, [revokeObjectUrls])

  // Start the simulation timer fallback
  const startSimulationTimer = useCallback((textWords, wordOffset, onCompleteCallback) => {
    if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
    
    sentenceWordsRef.current = textWords
    paragraphWordOffsetRef.current = wordOffset
    elapsedTimeRef.current = 0

    const runTimer = (durationMs) => {
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
      
      msPerWordRef.current = durationMs / textWords.length
      playbackStartTimeRef.current = Date.now() - elapsedTimeRef.current

      simulationIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - playbackStartTimeRef.current
        elapsedTimeRef.current = elapsed
        const calculatedIndex = Math.floor(elapsed / msPerWordRef.current)

        if (calculatedIndex < textWords.length) {
          setActiveWordIndex(wordOffset + calculatedIndex)
        } else {
          clearInterval(simulationIntervalRef.current)
          simulationIntervalRef.current = null
          if (onCompleteCallback) onCompleteCallback()
        }
      }, 50)
    }

    return runTimer
  }, [])

  // Fetch TTS audio through /api/tts
  //   Dev:  Vite proxy rewrites /api/tts → translate.google.com (strips Referer)
  //   Prod: Vercel serverless function api/tts.js fetches server-side (no CORS)
  // lang: 'en-IN' = Indian English accent | 'ml' = Kerala Malayalam
  const fetchTtsAudio = useCallback(async (text, lang, onError) => {
    const params = new URLSearchParams({ tl: lang, q: text })
    const apiUrl = `/api/tts?${params.toString()}`
    try {
      const response = await fetch(apiUrl)
      if (!response.ok) throw new Error(`TTS responded ${response.status}`)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      objectUrlsRef.current.push(objectUrl)
      return new Audio(objectUrl)
    } catch (err) {
      console.error(`TTS fetch failed for lang=${lang}:`, err)
      if (onError) onError(err)
      return null
    }
  }, [])


  // ─── Phrase-by-phrase bilingual reading ────────────────────────────────────
  // Pattern per sentence: English phrase 0 → Malayalam phrase 0 →
  //                       English phrase 1 → Malayalam phrase 1 → … → next sentence
  //
  // speakPhrase(paraIdx, sentenceIdx, phraseIdx, isEnglish)
  //   isEnglish=true  → read phrase[phraseIdx].english, then call back with isEnglish=false
  //   isEnglish=false → read phrase[phraseIdx].malayalam, advance phraseIdx
  // ────────────────────────────────────────────────────────────────────────────
  const speakPhrase = useCallback(async (paraIdx, sentenceIdx, phraseIdx, isEnglish) => {
    // Clean up previous audio
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
      activeAudioRef.current.onended = null
      activeAudioRef.current.onerror = null
      activeAudioRef.current = null
    }
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }

    const targetPara = STUDY_DATA[paraIdx]
    if (!targetPara) { stop(); return }
    const sentences = targetPara.sentences
    if (sentenceIdx >= sentences.length) { stop(); return }

    const sentence = sentences[sentenceIdx]
    const phrases = sentence.phrases || [
      { english: sentence.english, malayalam: sentence.malayalam }
    ]

    // Past the last phrase → advance to next sentence
    if (phraseIdx >= phrases.length) {
      const isFullParagraph = playModeRef.current === 'paragraph'
      if (isFullParagraph && sentenceIdx + 1 < sentences.length) {
        speakPhrase(paraIdx, sentenceIdx + 1, 0, true)
      } else {
        stop()
      }
      return
    }

    setActiveSentenceId(sentence.id)
    setPlayIndex(sentenceIdx)
    setPlayingParaIdx(paraIdx)
    setStatus('playing')

    const phrase = phrases[phraseIdx]

    if (isEnglish) {
      // ── Read English phrase, highlight words in the paragraph ──────────────
      setPlayLang('en')
      const phraseText = phrase.english
      const phraseWords = phraseText.split(/\s+/).filter(Boolean)

      // Calculate word offset within the full paragraph text for highlighting
      const startIndex = targetPara.englishText.indexOf(phraseText)
      let wordOffset = 0
      if (startIndex !== -1) {
        const before = targetPara.englishText.substring(0, startIndex)
        wordOffset = before.split(/\s+/).filter(Boolean).length
      }

      const onEnglishDone = () => {
        if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
        // After English phrase → read Malayalam translation of same phrase
        speakPhrase(paraIdx, sentenceIdx, phraseIdx, false)
      }

      const triggerTimer = startSimulationTimer(phraseWords, wordOffset, onEnglishDone)
      // Start estimated timer immediately so highlights appear without waiting for fetch
      triggerTimer(phraseWords.length * (310 / speechRate))

      const audio = await fetchTtsAudio(phraseText, 'en-IN', onEnglishDone)
      if (!audio) return

      audio.onloadedmetadata = () => {
        if (audio.duration && audio.duration > 0)
          triggerTimer((audio.duration * 1000) / speechRate)
      }
      audio.playbackRate = speechRate
      activeAudioRef.current = audio
      audio.onended = () => onEnglishDone()
      audio.onerror = () => onEnglishDone()
      audio.play().catch(() => onEnglishDone())

    } else {
      // ── Read Malayalam phrase, then advance to next English phrase ──────────
      setPlayLang('ml')
      setActiveWordIndex(-1)

      const onMalayalamDone = () => {
        // Advance to next phrase of this sentence, English side
        speakPhrase(paraIdx, sentenceIdx, phraseIdx + 1, true)
      }

      const audio = await fetchTtsAudio(phrase.malayalam, 'ml', onMalayalamDone)
      if (!audio) return

      audio.playbackRate = speechRate * 0.85
      activeAudioRef.current = audio
      audio.onended = () => onMalayalamDone()
      audio.onerror = () => onMalayalamDone()
      audio.play().catch(() => onMalayalamDone())
    }
  }, [speechRate, startSimulationTimer, stop, fetchTtsAudio])

  // Legacy wrapper — speakStep starts a sentence from phrase 0, English first
  const speakStep = useCallback((paraIdx, sentenceIdx) => {
    speakPhrase(paraIdx, sentenceIdx, 0, true)
  }, [speakPhrase])

  // ─── Grammar Lecture voice-over ──────────────────────────────────────────
  // Plays: English explanation → Malayalam explanation → example 1 EN → example 1 ML → …
  const playGrammarItem = useCallback(async (item) => {
    stop()
    setPlayMode('explanation')
    setStatus('playing')

    // Build a flat queue: [ {text, lang}, … ]
    const queue = []
    queue.push({ text: item.explanation.english,  lang: 'en-IN' })
    queue.push({ text: item.explanation.malayalam, lang: 'ml' })
    for (const ex of item.examples) {
      queue.push({ text: ex.en, lang: 'en-IN' })
      queue.push({ text: ex.ml, lang: 'ml' })
    }

    const playItem = async (idx) => {
      if (idx >= queue.length) { stop(); return }
      const { text, lang } = queue[idx]
      const chunks = splitTextIntoChunks(text, 150)

      const playChunk = async (ci) => {
        if (ci >= chunks.length) { playItem(idx + 1); return }
        const audio = await fetchTtsAudio(chunks[ci], lang, () => playChunk(ci + 1))
        if (!audio) { playChunk(ci + 1); return }
        audio.playbackRate = lang === 'ml' ? speechRate * 0.85 : speechRate
        activeAudioRef.current = audio
        audio.onended = () => playChunk(ci + 1)
        audio.onerror = () => playChunk(ci + 1)
        audio.play().catch(() => playChunk(ci + 1))
      }
      playChunk(0)
    }
    playItem(0)
  }, [speechRate, splitTextIntoChunks, stop, fetchTtsAudio])

  // Play a quiz explanation in Malayalam — chunked sequential blob playback
  const playExplanation = useCallback(async (explanationText) => {
    stop()
    setPlayMode('explanation')
    setStatus('playing')

    const chunks = splitTextIntoChunks(explanationText, 150)

    const playChunk = async (idx) => {
      if (idx >= chunks.length) { stop(); return }
      const audio = await fetchTtsAudio(chunks[idx], 'ml', () => playChunk(idx + 1))
      if (!audio) return
      audio.playbackRate = speechRate * 0.85
      activeAudioRef.current = audio
      audio.onended = () => playChunk(idx + 1)
      audio.onerror = () => playChunk(idx + 1)
      audio.play().catch(() => playChunk(idx + 1))
    }

    playChunk(0)
  }, [speechRate, splitTextIntoChunks, stop, fetchTtsAudio])

  // Resume paused audio
  const resume = useCallback(() => {
    if (activeAudioRef.current) {
      setStatus('playing')
      activeAudioRef.current.play().catch(err => console.error('Resume failed:', err))
    }
  }, [])

  // Play the entire paragraph sequentially (phrase by phrase)
  const playParagraph = useCallback((paraIdx) => {
    if (status === 'paused' && playingParaIdx === paraIdx) {
      resume()
      return
    }
    stop()
    setPlayMode('paragraph')
    speakPhrase(paraIdx, 0, 0, true)
  }, [status, playingParaIdx, speakPhrase, stop, resume])

  // Play a single sentence phrase-by-phrase then stop
  const playSentence = useCallback((paraIdx, _sentenceText, sentenceId) => {
    stop()
    const targetPara = STUDY_DATA[paraIdx]
    if (!targetPara) return
    const idx = targetPara.sentences.findIndex(s => s.id === sentenceId)
    if (idx !== -1) {
      setPlayMode('sentence')
      speakPhrase(paraIdx, idx, 0, true)
    }
  }, [speakPhrase, stop])

  // Pause playback
  const pause = useCallback(() => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
    }
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }
    setStatus('paused')
  }, [])


  // Clean speech, timers and blob object URLs on unmount
  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause()
        activeAudioRef.current = null
      }
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
      objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
      objectUrlsRef.current = []
    }
  }, [])

  // Handle clicking on a word in the paragraph views
  const handleWordClick = (paraIdx, wordStr) => {
    const vocab = getMatchingVocab(paraIdx, wordStr)
    if (vocab) {
      const elementId = `vocab-p${paraIdx}-${vocab.word.replace(/\s+/g, '-').toLowerCase()}`
      const element = document.getElementById(elementId)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element.classList.add('flash-highlight')
        setTimeout(() => element.classList.remove('flash-highlight'), 1500)
      }
    }
  }

  // Filtered vocabulary helper
  const getFilteredVocabularyForPara = (paraIdx) => {
    const vocab = STUDY_DATA[paraIdx].vocabulary
    if (!searchQuery) return vocab
    return vocab.filter(v => 
      v.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.meaning.includes(searchQuery)
    )
  }

  // Check if a word in the paragraph is part of the hovered vocabulary term
  const isWordHoveredInVocab = (paraIdx, wordStr) => {
    if (!hoveredVocab || hoveredVocab.paraIdx !== paraIdx) return false
    const termCleaned = hoveredVocab.word.toLowerCase()
    const wordCleaned = cleanWord(wordStr)
    return termCleaned.includes(wordCleaned) && wordCleaned.length > 2
  }

  // Quiz helper functions
  const handleSelectQuizOption = (option) => {
    if (isQuizSubmitted) return
    setSelectedQuizOption(option)
  }

  const handleSubmitQuizAnswer = () => {
    if (!selectedQuizOption || isQuizSubmitted) return
    
    const quizData = GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx]
    const isCorrect = selectedQuizOption === quizData.correctAnswer
    if (isCorrect) {
      setQuizScore(prev => prev + 1)
    }
    setIsQuizSubmitted(true)
  }

  const handleNextQuizQuestion = () => {
    const nextIdx = currentQuizQuestionIdx + 1
    if (nextIdx < GRAMMAR_QUIZ_DATA.length) {
      setCurrentQuizQuestionIdx(nextIdx)
      setSelectedQuizOption(null)
      setIsQuizSubmitted(false)
    } else {
      setQuizFinished(true)
    }
  }

  const handleRestartQuiz = () => {
    setQuizScore(0)
    setCurrentQuizQuestionIdx(0)
    setSelectedQuizOption(null)
    setIsQuizSubmitted(false)
    setQuizFinished(false)
  }

  return (
    <div className="app-container">
      {/* Brand Header */}
      <header className="main-header">
        <div className="logo-section">
          <span className="badge">BETA TESTING</span>
          <h1>AN OLD MAN WITH ENORMOUS WINGS</h1>
          <p className="subtitle">Bilingual Learning Assistant & Voice Tracker</p>
        </div>
      </header>

      {/* Global Toolbar */}
      <section className="global-toolbar-card">
        <div className="toolbar-header">
          <h3>🎙️ Speech & Learning Controls</h3>
          <p className="toolbar-desc">Configure cloud-synthesis speed rate and filter vocabulary cards instantly.</p>
        </div>
        <div className="toolbar-grid">
          
          <div className="toolbar-control-group">
            <label htmlFor="rate-select">Speech Speed Rate:</label>
            <select
              id="rate-select"
              value={speechRate}
              onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
              disabled={status !== 'idle'}
            >
              <option value="0.7">0.70x (Very Slow)</option>
              <option value="0.8">0.80x (Slow)</option>
              <option value="0.95">0.95x (Default)</option>
              <option value="1.1">1.10x (Fast)</option>
            </select>
          </div>

          <div className="toolbar-control-group search-container">
            <label htmlFor="vocab-search">Search Vocabulary:</label>
            <div className="search-input-wrapper">
              <input
                id="vocab-search"
                type="text"
                placeholder="Search words across all paragraphs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>
          </div>
          
          <div className="engine-status-badge">
            <span className="engine-dot active"></span>
            <span>Cloud TTS engine active (System-independent, Indian English en-IN & Malayalam ml)</span>
          </div>

        </div>
      </section>

      {/* Main Sequential Content Layout */}
      <main className="content-container">
        {STUDY_DATA.map((para, paraIdx) => {
          const isCurrentlyPlayingThisPara = playingParaIdx === paraIdx
          const filteredVocab = getFilteredVocabularyForPara(paraIdx)
          
          return (
            <article key={para.id} className="paragraph-section-card">
              <div className="paragraph-title-header">
                <h2>{para.title}</h2>
                <div className="title-divider"></div>
              </div>

              {/* Sub-grid for Paragraph Reader & Sentence translations */}
              <div className="paragraph-subgrid">
                
                {/* 1. English Reader Panel */}
                <div className="panel reader-panel">
                  <div className="panel-title">
                    <h4>English Reading</h4>
                  </div>
                  
                  <div className="text-display-box">
                    <p className="text-content">
                      {paragraphsWords[paraIdx].map((word, i) => {
                        let cls = 'word-span'
                        if (isCurrentlyPlayingThisPara && i === activeWordIndex) {
                          cls += ' word-active'
                        } else if (isCurrentlyPlayingThisPara && activeWordIndex > 0 && i < activeWordIndex) {
                          cls += ' word-spoken'
                        }
                        
                        if (isWordHoveredInVocab(paraIdx, word)) {
                          cls += ' word-hovered-vocab'
                        }
                        
                        const vocabMatch = getMatchingVocab(paraIdx, word)
                        if (vocabMatch) {
                          cls += ' has-vocab'
                        }

                        return (
                          <span
                            key={i}
                            className={cls}
                            onClick={() => handleWordClick(paraIdx, word)}
                            title={vocabMatch ? `Meaning: ${vocabMatch.meaning}` : 'Click word for vocabulary lookup'}
                          >
                            {word}{' '}
                          </span>
                        )
                      })}
                    </p>

                    <div className="audio-control-bar">
                      <div className="status-indicator">
                        <span className={`status-dot ${isCurrentlyPlayingThisPara ? status : 'idle'}`} />
                        <span className="status-text">
                          {(!isCurrentlyPlayingThisPara || status === 'idle') && 'Ready to play'}
                          {isCurrentlyPlayingThisPara && status === 'playing' && (
                            playMode === 'paragraph'
                              ? `Reading... [${playLang === 'en' ? 'English' : 'Malayalam'}]`
                              : playMode === 'sentence'
                              ? `Reading Sentence... [${playLang === 'en' ? 'English' : 'Malayalam'}]`
                              : 'Playing...'
                          )}
                          {isCurrentlyPlayingThisPara && status === 'paused' && 'Paused'}
                        </span>
                      </div>
                      <div className="button-group">
                        {isCurrentlyPlayingThisPara && status === 'playing' ? (
                          <button className="ctrl-btn btn-pause" onClick={pause}>
                            ⏸ Pause
                          </button>
                        ) : (
                          <button 
                            className="ctrl-btn btn-play" 
                            onClick={() => playParagraph(paraIdx)}
                          >
                            ▶ {isCurrentlyPlayingThisPara && status === 'paused' ? 'Resume' : 'Play Paragraph'}
                          </button>
                        )}
                        <button
                          className="ctrl-btn btn-stop"
                          onClick={stop}
                          disabled={!isCurrentlyPlayingThisPara || status === 'idle'}
                        >
                          ⏹ Stop
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. English with Malayalam Sentence Reading Panel */}
                <div className="panel translation-panel">
                  <div className="panel-title">
                    <h4>English with Malayalam Reading</h4>
                  </div>
                  <div className="sentence-list">
                    {para.sentences.map((s, sIdx) => {
                      const isCurrentPlaying = activeSentenceId === s.id && status === 'playing' && isCurrentlyPlayingThisPara
                      const isCurrentPlayingMl = isCurrentPlaying && playLang === 'ml'
                      const isCurrentPlayingEn = isCurrentPlaying && playLang === 'en'
                      
                      return (
                        <div 
                          key={s.id} 
                          className={`sentence-card ${isCurrentlyPlayingThisPara && activeSentenceId === s.id ? 'active' : ''}`}
                        >
                          <div className="sentence-header-row">
                            <button 
                              className="speak-sentence-btn"
                              onClick={() => playSentence(paraIdx, s.english, s.id)}
                            >
                              {isCurrentPlayingEn && '🔊 English...'}
                              {isCurrentPlayingMl && '🔊 Malayalam...'}
                              {!isCurrentPlaying && '🔈 Listen'}
                            </button>
                          </div>
                          <div className={`english-sentence ${isCurrentPlayingEn ? 'highlight-active-lang' : ''}`}>
                            {s.english}
                          </div>
                          <div className={`malayalam-sentence ${isCurrentPlayingMl ? 'highlight-active-lang' : ''}`}>
                            {s.malayalam}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

              </div>

              {/* 3. Below Vocabulary Panel */}
              <div className="panel vocabulary-panel">
                <div className="panel-title">
                  <h4>✍️ Vocabulary</h4>
                </div>
                <div className="vocab-grid">
                  {filteredVocab.length > 0 ? (
                    filteredVocab.map((v, vIdx) => (
                      <div
                        key={vIdx}
                        id={`vocab-p${paraIdx}-${v.word.replace(/\s+/g, '-').toLowerCase()}`}
                        className="vocab-card"
                        onMouseEnter={() => setHoveredVocab({ paraIdx, word: v.word })}
                        onMouseLeave={() => setHoveredVocab(null)}
                      >
                        <div className="vocab-card-header">
                          <span className="vocab-term">{v.word}</span>
                          <span className="vocab-index">#{vIdx + 1}</span>
                        </div>
                        <div className="vocab-meaning">{v.meaning}</div>
                      </div>
                    ))
                  ) : (
                    <div className="no-vocab-results">
                      No vocabulary terms match "{searchQuery}" in this paragraph.
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}

        {/* 4. Grammar Lecture Section */}
        <section className="grammar-lecture-section-card">
          <div className="lecture-header">
            <h2>📘 Grammar Lecture (വ്യാകരണ ക്ലാസ്സ്)</h2>
            <div className="title-divider"></div>
          </div>

          <div className="lecture-content">
            
            {/* Prepositions */}
            <div className="lecture-chapter">
              <h3>{GRAMMAR_LECTURE_DATA.prepositions.title}</h3>
              <div className="intro-block">
                <p className="intro-en">{GRAMMAR_LECTURE_DATA.prepositions.intro.english}</p>
                <p className="intro-ml">{GRAMMAR_LECTURE_DATA.prepositions.intro.malayalam}</p>
              </div>

              <div className="lecture-items-grid">
                {GRAMMAR_LECTURE_DATA.prepositions.items.map((item, idx) => (
                  <div key={idx} className="lecture-item-card">
                    <div className="lecture-item-card-header">
                      <div className="lecture-item-badge">{item.word}</div>
                      <button
                        className="grammar-listen-btn"
                        onClick={() => playGrammarItem(item)}
                        title={`Listen to ${item.word} explanation`}
                      >
                        🔊 Listen
                      </button>
                    </div>
                    <div className="lecture-item-explanation">
                      <p className="item-en"><strong>English:</strong> {item.explanation.english}</p>
                      <p className="item-ml"><strong>Malayalam:</strong> {item.explanation.malayalam}</p>
                    </div>
                    <div className="lecture-item-examples">
                      <h5>Examples (ഉദാഹരണങ്ങൾ):</h5>
                      <ul>
                        {item.examples.map((ex, eIdx) => (
                          <li key={eIdx}>
                            <p className="ex-en">✨ {ex.en}</p>
                            <p className="ex-ml">{ex.ml}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-container">
                <h4>Quick Revision Summary Table (ഒരു ലളിത സംഗ്രഹം)</h4>
                <table className="lecture-summary-table">
                  <thead>
                    <tr>
                      <th>Preposition</th>
                      <th>Shortcut Meaning (English)</th>
                      <th>പ്രധാന അർത്ഥം (Malayalam)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GRAMMAR_LECTURE_DATA.prepositions.table.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="tbl-highlight">{row.word}</td>
                        <td>{row.shortcut}</td>
                        <td className="tbl-highlight-ml">{row.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Articles */}
            <div className="lecture-chapter">
              <h3>{GRAMMAR_LECTURE_DATA.articles.title}</h3>
              <div className="intro-block">
                <p className="intro-en">{GRAMMAR_LECTURE_DATA.articles.intro.english}</p>
                <p className="intro-ml">{GRAMMAR_LECTURE_DATA.articles.intro.malayalam}</p>
              </div>

              <div className="articles-types-bar">
                {GRAMMAR_LECTURE_DATA.articles.types.map((type, idx) => (
                  <div key={idx} className="article-type-pill">
                    <strong>{type.name}:</strong> {type.desc}
                  </div>
                ))}
              </div>

              <div className="lecture-items-grid">
                {GRAMMAR_LECTURE_DATA.articles.items.map((item, idx) => (
                  <div key={idx} className="lecture-item-card">
                    <div className="lecture-item-card-header">
                      <div className="lecture-item-badge article-badge">{item.word}</div>
                      <button
                        className="grammar-listen-btn"
                        onClick={() => playGrammarItem(item)}
                        title={`Listen to ${item.word} explanation`}
                      >
                        🔊 Listen
                      </button>
                    </div>
                    <div className="lecture-item-explanation">
                      <p className="item-en"><strong>English:</strong> {item.explanation.english}</p>
                      <p className="item-ml"><strong>Malayalam:</strong> {item.explanation.malayalam}</p>
                    </div>
                    <div className="lecture-item-examples">
                      <h5>Examples (ഉദാഹരണങ്ങൾ):</h5>
                      <ul>
                        {item.examples.map((ex, eIdx) => (
                          <li key={eIdx}>
                            <p className="ex-en">✨ {ex.en}</p>
                            <p className="ex-ml">{ex.ml}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-container">
                <h4>Quick Summary for Students (വിദ്യാർത്ഥികൾക്കായുള്ള എളുപ്പവഴി)</h4>
                <table className="lecture-summary-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>ഒപ്പം ചേർക്കേണ്ടത് (Rule)</th>
                      <th>Shortcut Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GRAMMAR_LECTURE_DATA.articles.table.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="tbl-highlight">{row.article}</td>
                        <td>{row.rule}</td>
                        <td className="tbl-highlight-ml">{row.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </section>

        {/* 5. Grammar Queries Section */}
        <section className="grammar-queries-section-card">
          <div className="queries-header">
            <h2>📝 Grammar Queries (വ്യാകരണ ചോദ്യങ്ങൾ)</h2>
            <div className="title-divider"></div>
          </div>

          <div className="queries-content">
            {!quizFinished ? (
              <div className="quiz-container">
                <div className="quiz-top-info">
                  <span className="quiz-progress">
                    Question <strong>{currentQuizQuestionIdx + 1}</strong> of <strong>{GRAMMAR_QUIZ_DATA.length}</strong>
                  </span>
                  <span className="quiz-score-badge">Score: {quizScore}</span>
                </div>

                <div className="quiz-question-box">
                  <p className="quiz-question-text">
                    {GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx].question}
                  </p>
                  
                  <div className="quiz-options-grid">
                    {GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx].options.map((opt, oIdx) => {
                      const isSelected = selectedQuizOption === opt
                      const isCorrect = opt === GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx].correctAnswer
                      let optClass = "quiz-option-btn"

                      if (isQuizSubmitted) {
                        if (isCorrect) {
                          optClass += " option-correct"
                        } else if (isSelected) {
                          optClass += " option-incorrect"
                        } else {
                          optClass += " option-disabled"
                        }
                      } else if (isSelected) {
                        optClass += " option-selected"
                      }

                      return (
                        <button
                          key={oIdx}
                          className={optClass}
                          onClick={() => handleSelectQuizOption(opt)}
                          disabled={isQuizSubmitted}
                        >
                          <span className="option-letter">{String.fromCharCode(65 + oIdx)}.</span> {opt}
                        </button>
                      )
                    })}
                  </div>

                  <div className="quiz-actions-bar">
                    {!isQuizSubmitted ? (
                      <button
                        className="quiz-action-btn"
                        onClick={handleSubmitQuizAnswer}
                        disabled={!selectedQuizOption}
                      >
                        Check Answer
                      </button>
                    ) : (
                      <button
                        className="quiz-action-btn next-btn"
                        onClick={handleNextQuizQuestion}
                      >
                        {currentQuizQuestionIdx + 1 === GRAMMAR_QUIZ_DATA.length ? "Finish Quiz" : "Next Question"}
                      </button>
                    )}
                  </div>
                </div>

                {isQuizSubmitted && (
                  <div className="quiz-explanation-box">
                    <div className="explanation-header">
                      <h4>വിശദീകരണം (Explanation):</h4>
                      <button
                        className="speak-explanation-btn"
                        onClick={() => playExplanation(GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx].explanation)}
                        title="Listen to explanation in Malayalam"
                      >
                        🔊 Listen
                      </button>
                    </div>
                    <p className="explanation-text">
                      {GRAMMAR_QUIZ_DATA[currentQuizQuestionIdx].explanation}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="quiz-results-card">
                <div className="results-icon">🏆</div>
                <h3>Quiz Completed!</h3>
                <p className="results-score">
                  You scored <strong>{quizScore}</strong> out of <strong>{GRAMMAR_QUIZ_DATA.length}</strong> questions correctly!
                </p>
                <button className="quiz-action-btn" onClick={handleRestartQuiz}>
                  Try Again
                </button>
              </div>
            )}
          </div>
        </section>

      </main>

      <footer className="app-footer">
        <p>Bilingual Audio Learning Assistant. Crafted for Malayalam speaking learners with grammar checks.</p>
      </footer>
    </div>
  )
}

export default App
