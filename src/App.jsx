import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { STUDY_DATA } from './data'

function App() {
  const [activeParaIdx, setActiveParaIdx] = useState(0)
  const [status, setStatus] = useState('idle') // idle | playing | paused
  const [activeWordIndex, setActiveWordIndex] = useState(-1)
  
  // Voice states
  const [voices, setVoices] = useState([])
  const [malayalamVoices, setMalayalamVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const [selectedMalayalamVoice, setSelectedMalayalamVoice] = useState('')
  
  const [speechRate, setSpeechRate] = useState(0.95) // Adjustable speech rate
  const [sidebarTab, setSidebarTab] = useState('translation') // translation | vocabulary | quiz
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedWord, setSelectedWord] = useState(null) // Word selected for detail lookup
  const [hoveredVocabTerm, setHoveredVocabTerm] = useState(null)
  
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
  const utterRef = useRef(null)
  const playModeRef = useRef('idle')
  const playIndexRef = useRef(-1)
  const playLangRef = useRef('en')

  useEffect(() => {
    playModeRef.current = playMode
  }, [playMode])

  useEffect(() => {
    playIndexRef.current = playIndex
  }, [playIndex])

  useEffect(() => {
    playLangRef.current = playLang
  }, [playLang])

  const currentPara = STUDY_DATA[activeParaIdx]

  // Track speech boundaries and fallback simulation timer
  const simulationIntervalRef = useRef(null)
  const lastNativeWordBoundaryTimeRef = useRef(0)
  const playbackStartTimeRef = useRef(0)

  // Tokenize paragraph and calculate exact character ranges for each word
  const wordRanges = useMemo(() => {
    const ranges = []
    const regex = /\S+/g
    let match
    while ((match = regex.exec(currentPara.englishText)) !== null) {
      ranges.push({
        text: match[0],
        start: match.index,
        end: regex.lastIndex
      })
    }
    return ranges
  }, [currentPara])

  // Get list of word strings for rendering
  const words = useMemo(() => {
    return wordRanges.map(w => w.text)
  }, [wordRanges])

  // Helper to find word index from charIndex
  const getWordIndexFromCharIndex = useCallback((charIndex, ranges) => {
    for (let i = 0; i < ranges.length; i++) {
      if (charIndex >= ranges[i].start && charIndex < ranges[i].end) {
        return i
      }
    }
    // Fallback if index falls between words
    for (let i = 0; i < ranges.length; i++) {
      if (ranges[i].start >= charIndex) {
        return i
      }
    }
    return ranges.length - 1
  }, [])

  // Helper to normalize strings for comparison (remove punctuation, lower case)
  const cleanWord = (word) => {
    return word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim()
  }

  // Find if a word matches any vocabulary term
  const getMatchingVocab = useCallback((wordStr) => {
    if (!wordStr) return null
    const cleaned = cleanWord(wordStr)
    return currentPara.vocabulary.find(v => {
      const vCleaned = v.word.toLowerCase()
      return vCleaned === cleaned || vCleaned.includes(cleaned)
    })
  }, [currentPara])

  // Load standard Web Speech voices, prioritizing Indian accents for English
  const loadVoices = () => {
    const available = speechSynthesis.getVoices()
    
    // Filter English voices
    const english = available.filter(v => v.lang.toLowerCase().startsWith('en'))
    setVoices(english.length > 0 ? english : available)
    
    // Filter Malayalam voices
    const malayalam = available.filter(v => v.lang.toLowerCase().startsWith('ml'))
    setMalayalamVoices(malayalam)
    
    // Set default English voice (prioritize en-IN)
    if (english.length > 0 && !selectedVoice) {
      const indEnglish = english.find(v => v.lang.toLowerCase() === 'en-in') 
        || english.find(v => v.name.toLowerCase().includes('india'))
        || english.find(v => v.name.toLowerCase().includes('heera'))
        || english.find(v => v.name.toLowerCase().includes('veena'))
        || english.find(v => v.name.toLowerCase().includes('ravi'))
        || english.find(v => v.name.toLowerCase().includes('natural'))
        || english[0]
      setSelectedVoice(indEnglish.name)
    }
    
    // Set default Malayalam voice
    if (malayalam.length > 0 && !selectedMalayalamVoice) {
      setSelectedMalayalamVoice(malayalam[0].name)
    }
  }

  useEffect(() => {
    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices
    return () => { speechSynthesis.onvoiceschanged = null }
  }, [])

  // Stop any playing speech and clear simulation timers
  const stop = useCallback(() => {
    speechSynthesis.cancel()
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }
    setStatus('idle')
    setActiveWordIndex(-1)
    setActiveSentenceId(null)
    setPlayIndex(-1)
    setPlayMode('idle')
    utterRef.current = null
    lastNativeWordBoundaryTimeRef.current = 0
  }, [])

  // Start the simulation timer fallback (speed-adjusted, cooperative with native)
  const startSimulationTimer = useCallback((textWords, wordOffset = 0, startIndexWithinText = 0, onCompleteCallback) => {
    if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
    
    const msPerWord = 310 / speechRate
    playbackStartTimeRef.current = Date.now()

    simulationIntervalRef.current = setInterval(() => {
      // Cooperative Sync: If a native word boundary fired in the last 1.2 seconds,
      // let the native events drive the highlight. Don't overwrite.
      if (lastNativeWordBoundaryTimeRef.current > 0 && (Date.now() - lastNativeWordBoundaryTimeRef.current < 1200)) {
        return
      }

      const elapsed = Date.now() - playbackStartTimeRef.current
      const calculatedIndex = Math.floor(elapsed / msPerWord)
      const currentIndexWithinText = startIndexWithinText + calculatedIndex

      if (currentIndexWithinText < textWords.length) {
        setActiveWordIndex(wordOffset + calculatedIndex)
      } else {
        if (simulationIntervalRef.current) {
          clearInterval(simulationIntervalRef.current)
          simulationIntervalRef.current = null
        }
        if (onCompleteCallback) {
          onCompleteCallback()
        } else {
          stop()
        }
      }
    }, 80)
  }, [stop, speechRate])

  // Sequential Playback Step runner
  const speakStep = useCallback((sentenceIdx, lang) => {
    speechSynthesis.cancel()
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }

    const sentences = currentPara.sentences
    if (sentenceIdx < 0 || sentenceIdx >= sentences.length) {
      stop()
      return
    }

    const sentence = sentences[sentenceIdx]
    setActiveSentenceId(sentence.id)
    setPlayIndex(sentenceIdx)
    setPlayLang(lang)

    if (lang === 'en') {
      const sentenceText = sentence.english
      const sentenceWords = sentenceText.split(/\s+/).filter(Boolean)
      const startIndex = currentPara.englishText.indexOf(sentenceText)
      let paragraphWordOffset = 0
      if (startIndex !== -1) {
        const precedingText = currentPara.englishText.substring(0, startIndex)
        paragraphWordOffset = precedingText.split(/\s+/).filter(Boolean).length
      }

      // Build local word ranges for the spoken sentence
      const sentenceRanges = []
      const regex = /\S+/g
      let match
      while ((match = regex.exec(sentenceText)) !== null) {
        sentenceRanges.push({
          text: match[0],
          start: match.index,
          end: regex.lastIndex
        })
      }

      const utter = new SpeechSynthesisUtterance(sentenceText)
      utter.rate = speechRate
      const voice = speechSynthesis.getVoices().find(v => v.name === selectedVoice)
      if (voice) utter.voice = voice

      const transitionToMalayalam = () => {
        if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
        speakStep(sentenceIdx, 'ml')
      }

      utter.onboundary = (e) => {
        if (!e.name || e.name === 'word') {
          lastNativeWordBoundaryTimeRef.current = Date.now()
          const sentenceWordIdx = getWordIndexFromCharIndex(e.charIndex, sentenceRanges)
          if (sentenceWordIdx !== -1) {
            setActiveWordIndex(paragraphWordOffset + sentenceWordIdx)
          }
        }
      }

      utter.onend = () => {
        transitionToMalayalam()
      }

      utter.onerror = (e) => {
        console.error("English Speech Error:", e)
        transitionToMalayalam()
      }

      utterRef.current = utter
      setStatus('playing')
      setActiveWordIndex(paragraphWordOffset)
      speechSynthesis.speak(utter)

      startSimulationTimer(sentenceWords, paragraphWordOffset, 0, transitionToMalayalam)
    } else {
      // Malayalam sentence playback
      const sentenceText = sentence.malayalam
      const utter = new SpeechSynthesisUtterance(sentenceText)
      utter.lang = 'ml-IN'
      // Malayalam can be spoken a bit slower for clarity
      utter.rate = speechRate * 0.85

      const voice = speechSynthesis.getVoices().find(v => v.name === selectedMalayalamVoice)
      if (voice) {
        utter.voice = voice
      } else {
        // If no Malayalam voice matches, try to find any 'ml' voice, or just use the browser default
        const fallbackMl = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('ml'))
        if (fallbackMl) utter.voice = fallbackMl
      }

      // Hide active English words since we are playing Malayalam translation
      setActiveWordIndex(-1)

      const handleMalayalamEnd = () => {
        if (playModeRef.current === 'paragraph' && sentenceIdx + 1 < currentPara.sentences.length) {
          speakStep(sentenceIdx + 1, 'en')
        } else {
          stop()
        }
      }

      utter.onend = () => {
        handleMalayalamEnd()
      }

      utter.onerror = (e) => {
        console.error("Malayalam Speech Error:", e)
        handleMalayalamEnd()
      }

      utterRef.current = utter
      setStatus('playing')
      speechSynthesis.speak(utter)
    }
  }, [currentPara, selectedVoice, selectedMalayalamVoice, speechRate, getWordIndexFromCharIndex, startSimulationTimer, stop])

  // Play the entire paragraph sequentially
  const playParagraph = useCallback(() => {
    if (status === 'paused') {
      speechSynthesis.resume()
      setStatus('playing')
      return
    }

    stop()
    setPlayMode('paragraph')
    speakStep(0, 'en')
  }, [status, speakStep, stop])

  // Play a specific sentence (reads English, then reads Malayalam, then stops)
  const playSentence = useCallback((sentenceText, sentenceId) => {
    stop()
    const idx = currentPara.sentences.findIndex(s => s.id === sentenceId)
    if (idx !== -1) {
      setPlayMode('sentence')
      speakStep(idx, 'en')
    }
  }, [currentPara, speakStep, stop])

  // Play a quiz explanation in Malayalam
  const playExplanation = useCallback((explanationText) => {
    stop()
    setPlayMode('explanation')
    setStatus('playing')

    const utter = new SpeechSynthesisUtterance(explanationText)
    utter.lang = 'ml-IN'
    utter.rate = speechRate * 0.85
    const voice = speechSynthesis.getVoices().find(v => v.name === selectedMalayalamVoice)
    if (voice) {
      utter.voice = voice
    } else {
      const fallbackMl = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('ml'))
      if (fallbackMl) utter.voice = fallbackMl
    }

    utter.onend = () => {
      stop()
    }

    utter.onerror = () => {
      stop()
    }

    utterRef.current = utter
    speechSynthesis.speak(utter)
  }, [selectedMalayalamVoice, speechRate, stop])

  // Pause playback
  const pause = useCallback(() => {
    speechSynthesis.pause()
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }
    setStatus('paused')
  }, [])

  // Auto-stop speech and reset quiz when switching paragraphs
  useEffect(() => {
    stop()
    setSelectedWord(null)
    setQuizScore(0)
    setCurrentQuizQuestionIdx(0)
    setSelectedQuizOption(null)
    setIsQuizSubmitted(false)
    setQuizFinished(false)
  }, [activeParaIdx, stop])

  // Clean speech and timers on unmount
  useEffect(() => {
    return () => {
      speechSynthesis.cancel()
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
    }
  }, [])

  // Handle clicking on a word in the main paragraph view
  const handleWordClick = (wordStr) => {
    const vocab = getMatchingVocab(wordStr)
    if (vocab) {
      setSelectedWord(vocab)
      setSidebarTab('vocabulary')
      setTimeout(() => {
        const element = document.getElementById(`vocab-${vocab.word.replace(/\s+/g, '-').toLowerCase()}`)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          element.classList.add('flash-highlight')
          setTimeout(() => element.classList.remove('flash-highlight'), 1500)
        }
      }, 100)
    }
  }

  // Filtered vocabulary based on search
  const filteredVocabulary = useMemo(() => {
    return currentPara.vocabulary.filter(v => 
      v.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.meaning.includes(searchQuery)
    )
  }, [currentPara, searchQuery])

  // Check if a word in the paragraph is part of the hovered vocabulary term
  const isWordHoveredInVocab = (wordStr) => {
    if (!hoveredVocabTerm) return false
    const termCleaned = hoveredVocabTerm.toLowerCase()
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
    
    const quizData = currentPara.quiz[currentQuizQuestionIdx]
    const isCorrect = selectedQuizOption === quizData.correctAnswer
    if (isCorrect) {
      setQuizScore(prev => prev + 1)
    }
    setIsQuizSubmitted(true)
  }

  const handleNextQuizQuestion = () => {
    const nextIdx = currentQuizQuestionIdx + 1
    if (nextIdx < currentPara.quiz.length) {
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
          <h1>ബഹുഭാഷാ സഹായി</h1>
          <p className="subtitle">Bilingual Learning Assistant & Indian Accent Voice Tracker</p>
        </div>
        <div className="paragraph-tabs">
          {STUDY_DATA.map((p, idx) => (
            <button
              key={p.id}
              className={`tab-btn ${activeParaIdx === idx ? 'active' : ''}`}
              onClick={() => setActiveParaIdx(idx)}
            >
              {p.title}
            </button>
          ))}
        </div>
      </header>

      {/* Main Layout Grid */}
      <main className="main-grid">
        
        {/* Left Side: Interactive Reader */}
        <section className="reader-section">
          <div className="section-header">
            <h2>English Reader</h2>
            <div className="voice-controls">
              <div className="controls-row">
                {voices.length > 0 && (
                  <div className="control-group">
                    <label htmlFor="voice-select">English Voice:</label>
                    <select
                      id="voice-select"
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      disabled={status !== 'idle'}
                    >
                      {voices.map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name.replace(/Microsoft|Google/g, '').trim()} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {malayalamVoices.length > 0 ? (
                  <div className="control-group">
                    <label htmlFor="ml-voice-select">Malayalam Voice:</label>
                    <select
                      id="ml-voice-select"
                      value={selectedMalayalamVoice}
                      onChange={(e) => setSelectedMalayalamVoice(e.target.value)}
                      disabled={status !== 'idle'}
                    >
                      {malayalamVoices.map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name.replace(/Microsoft|Google/g, '').trim()} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="control-group ml-notice">
                    <span className="notice-icon">ℹ️</span>
                    <span>No Malayalam Voice detected. Speech will fallback.</span>
                  </div>
                )}
                <div className="control-group">
                  <label htmlFor="rate-select">Speed:</label>
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
              </div>
            </div>
          </div>

          {/* Interactive Text Display Container */}
          <div className="text-display-card">
            <div className="text-content">
              {words.map((word, i) => {
                let cls = 'word-span'
                if (i === activeWordIndex) cls += ' word-active'
                else if (activeWordIndex > 0 && i < activeWordIndex) cls += ' word-spoken'
                
                // Highlight words associated with glossary term hover
                if (isWordHoveredInVocab(word)) {
                  cls += ' word-hovered-vocab'
                }
                
                const vocabMatch = getMatchingVocab(word)
                if (vocabMatch) {
                  cls += ' has-vocab'
                }

                return (
                  <span
                    key={i}
                    className={cls}
                    onClick={() => handleWordClick(word)}
                    title={vocabMatch ? `Meaning: ${vocabMatch.meaning}` : 'Click to read'}
                  >
                    {word}{' '}
                  </span>
                )
              })}
            </div>

            {/* Read Aloud controls */}
            <div className="audio-control-bar">
              <div className="status-indicator">
                <span className={`status-dot ${status}`} />
                <span className="status-text">
                  {status === 'idle' && 'Ready to play'}
                  {status === 'playing' && (
                    playMode === 'paragraph'
                      ? `Reading paragraph... [${playLang === 'en' ? 'English' : 'Malayalam Translation'}]`
                      : playMode === 'sentence'
                      ? `Reading selected sentence... [${playLang === 'en' ? 'English' : 'Malayalam Translation'}]`
                      : playMode === 'explanation'
                      ? 'Speaking explanation in Malayalam...'
                      : 'Playing...'
                  )}
                  {status === 'paused' && 'Paused'}
                </span>
              </div>
              <div className="button-group">
                {status === 'playing' ? (
                  <button className="ctrl-btn btn-pause" onClick={pause}>
                    ⏸ Pause
                  </button>
                ) : (
                  <button className="ctrl-btn btn-play" onClick={playParagraph}>
                    ▶ {status === 'paused' ? 'Resume Paragraph' : 'Play Paragraph'}
                  </button>
                )}
                <button
                  className="ctrl-btn btn-stop"
                  onClick={stop}
                  disabled={status === 'idle'}
                >
                  ⏹ Stop
                </button>
              </div>
            </div>
          </div>

          {/* Quick instructions alert */}
          <div className="tip-box">
            <span className="tip-icon">💡</span>
            <p><strong>Tip for Students:</strong> Listen to the text read sequentially in an Indian accent, followed by the Malayalam meaning. Click words to check meanings!</p>
          </div>
        </section>

        {/* Right Side: Bilingual Helper Sidebar */}
        <section className="helper-sidebar">
          {/* Tabs header */}
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab-btn ${sidebarTab === 'translation' ? 'active' : ''}`}
              onClick={() => setSidebarTab('translation')}
            >
              📖 പരിഭാഷ (Translations)
            </button>
            <button
              className={`sidebar-tab-btn ${sidebarTab === 'vocabulary' ? 'active' : ''}`}
              onClick={() => setSidebarTab('vocabulary')}
            >
              ✍️ പദാവലി (Vocabulary)
            </button>
            <button
              className={`sidebar-tab-btn ${sidebarTab === 'quiz' ? 'active' : ''}`}
              onClick={() => setSidebarTab('quiz')}
            >
              📝 ക്വിസ് (Grammar Quiz)
            </button>
          </div>

          {/* Tab Content 1: Sentence by Sentence Translation */}
          {sidebarTab === 'translation' && (
            <div className="tab-pane translation-pane">
              <p className="tab-instruction">ക്ലിക്ക് ചെയ്ത് ഓരോ വാക്യവും പ്രത്യേകം കേൾക്കുക:</p>
              <div className="sentence-list">
                {currentPara.sentences.map((s, sIdx) => {
                  const isCurrentPlaying = activeSentenceId === s.id && status === 'playing'
                  const isCurrentPlayingMl = isCurrentPlaying && playLang === 'ml'
                  const isCurrentPlayingEn = isCurrentPlaying && playLang === 'en'
                  return (
                    <div 
                      key={s.id} 
                      className={`sentence-card ${activeSentenceId === s.id ? 'active' : ''}`}
                    >
                      <div className="sentence-header-row">
                        <button 
                          className="speak-sentence-btn"
                          onClick={() => playSentence(s.english, s.id)}
                          title="Listen to this sentence"
                        >
                          {isCurrentPlayingEn && '🔊 English...'}
                          {isCurrentPlayingMl && '🔊 Malayalam...'}
                          {!isCurrentPlaying && '🔈 Listen'}
                        </button>
                      </div>
                      <div className={`english-sentence ${isCurrentPlayingEn ? 'highlight-active-lang' : ''}`}>{s.english}</div>
                      <div className={`malayalam-sentence ${isCurrentPlayingMl ? 'highlight-active-lang' : ''}`}>{s.malayalam}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tab Content 2: Vocabulary Glossary */}
          {sidebarTab === 'vocabulary' && (
            <div className="tab-pane vocabulary-pane">
              <div className="search-bar-container">
                <input
                  type="text"
                  placeholder="Search words (e.g. mud, wings...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                {searchQuery && (
                  <button className="clear-btn" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>

              <div className="vocab-list">
                {filteredVocabulary.length > 0 ? (
                  filteredVocabulary.map((v, index) => {
                    const isSelected = selectedWord && selectedWord.word === v.word
                    return (
                      <div
                        key={index}
                        id={`vocab-${v.word.replace(/\s+/g, '-').toLowerCase()}`}
                        className={`vocab-card ${isSelected ? 'highlighted' : ''}`}
                        onMouseEnter={() => setHoveredVocabTerm(v.word)}
                        onMouseLeave={() => setHoveredVocabTerm(null)}
                      >
                        <div className="vocab-card-header">
                          <span className="vocab-term">{v.word}</span>
                          <span className="vocab-index">#{index + 1}</span>
                        </div>
                        <div className="vocab-meaning">{v.meaning}</div>
                        {v.word.includes(' ') && (
                          <div className="vocab-phrase-badge">Phrase / പ്രയോഗം</div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="no-results">No vocabulary terms match your search.</div>
                )}
              </div>
            </div>
          )}

          {/* Tab Content 3: Grammar Quiz */}
          {sidebarTab === 'quiz' && (
            <div className="tab-pane quiz-pane">
              {!quizFinished ? (
                <div>
                  <div className="quiz-progress-bar">
                    <span className="quiz-progress-text">
                      Question {currentQuizQuestionIdx + 1} of {currentPara.quiz.length}
                    </span>
                    <span className="quiz-score-badge">Score: {quizScore}</span>
                  </div>

                  <div className="quiz-question-card">
                    <p className="quiz-question-text">
                      {currentPara.quiz[currentQuizQuestionIdx].question}
                    </p>
                    <div className="quiz-options-list">
                      {currentPara.quiz[currentQuizQuestionIdx].options.map((opt, oIdx) => {
                        const isSelected = selectedQuizOption === opt
                        const isCorrect = opt === currentPara.quiz[currentQuizQuestionIdx].correctAnswer
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
                        {currentQuizQuestionIdx + 1 === currentPara.quiz.length ? "Finish Quiz" : "Next Question"}
                      </button>
                    )}
                  </div>

                  {isQuizSubmitted && (
                    <div className="quiz-explanation-box">
                      <div className="explanation-header">
                        <h4>വിശദീകരണം (Explanation):</h4>
                        <button
                          className="speak-explanation-btn"
                          onClick={() => playExplanation(currentPara.quiz[currentQuizQuestionIdx].explanation)}
                          title="Listen to explanation in Malayalam"
                        >
                          🔊 Listen
                        </button>
                      </div>
                      <p className="explanation-text">
                        {currentPara.quiz[currentQuizQuestionIdx].explanation}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="quiz-results-card">
                  <div className="results-icon">🏆</div>
                  <h3>Quiz Completed!</h3>
                  <p className="results-score">
                    You scored <strong>{quizScore}</strong> out of <strong>{currentPara.quiz.length}</strong> questions correctly!
                  </p>
                  <button className="quiz-action-btn" onClick={handleRestartQuiz}>
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

      </main>

      <footer className="app-footer">
        <p>Bilingual Audio Learning Assistant. Crafted for Malayalam speaking learners with grammar checks.</p>
      </footer>
    </div>
  )
}

export default App
