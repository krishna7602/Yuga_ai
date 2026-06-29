import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { STUDY_DATA } from './data'

function App() {
  const [activeParaIdx, setActiveParaIdx] = useState(0)
  const [status, setStatus] = useState('idle') // idle | playing | paused
  const [activeWordIndex, setActiveWordIndex] = useState(-1)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const [speechRate, setSpeechRate] = useState(0.95) // Adjustable speech rate
  const [sidebarTab, setSidebarTab] = useState('translation') // translation | vocabulary
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedWord, setSelectedWord] = useState(null) // Word selected for detail lookup
  const [hoveredVocabTerm, setHoveredVocabTerm] = useState(null)
  
  const utterRef = useRef(null)
  const [activeSentenceId, setActiveSentenceId] = useState(null) // Sentence currently playing/selected

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
      // Match if the word matches or is part of a phrase (e.g. "wings" matches "enormous wings")
      return vCleaned === cleaned || vCleaned.includes(cleaned)
    })
  }, [currentPara])

  // Load standard Web Speech voices
  const loadVoices = () => {
    const available = speechSynthesis.getVoices()
    const english = available.filter(v => v.lang.startsWith('en'))
    setVoices(english.length > 0 ? english : available)
    if (english.length > 0 && !selectedVoice) {
      const preferred = english.find(v => v.name.includes('Google') || v.name.includes('Natural')) || english[0]
      setSelectedVoice(preferred.name)
    } else if (available.length > 0 && !selectedVoice) {
      setSelectedVoice(available[0].name)
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
    utterRef.current = null
    lastNativeWordBoundaryTimeRef.current = 0
  }, [])

  // Start the simulation timer fallback (speed-adjusted, cooperative with native)
  const startSimulationTimer = useCallback((textWords, wordOffset = 0, startIndexWithinText = 0) => {
    if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current)
    
    // Average baseline word length is ~310ms. Adjusted by current speechRate setting.
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
        stop()
      }
    }, 80)
  }, [stop, speechRate])

  // Play the entire paragraph
  const playParagraph = useCallback(() => {
    if (status === 'paused') {
      speechSynthesis.resume()
      setStatus('playing')
      
      if (simulationIntervalRef.current === null) {
        if (activeSentenceId) {
          const sentence = currentPara.sentences.find(s => s.id === activeSentenceId)
          if (sentence) {
            const sentenceWords = sentence.english.split(/\s+/).filter(Boolean)
            const startIndex = currentPara.englishText.indexOf(sentence.english)
            let paragraphWordOffset = 0
            if (startIndex !== -1) {
              const precedingText = currentPara.englishText.substring(0, startIndex)
              paragraphWordOffset = precedingText.split(/\s+/).filter(Boolean).length
            }
            const startIndexWithinText = Math.max(0, activeWordIndex - paragraphWordOffset)
            startSimulationTimer(sentenceWords, activeWordIndex, startIndexWithinText)
          }
        } else {
          startSimulationTimer(words, activeWordIndex, activeWordIndex)
        }
      }
      return
    }

    stop()

    const utter = new SpeechSynthesisUtterance(currentPara.englishText)
    utter.rate = speechRate

    const voice = speechSynthesis.getVoices().find(v => v.name === selectedVoice)
    if (voice) utter.voice = voice

    utter.onboundary = (e) => {
      if (!e.name || e.name === 'word') {
        lastNativeWordBoundaryTimeRef.current = Date.now()
        const wordIdx = getWordIndexFromCharIndex(e.charIndex, wordRanges)
        if (wordIdx !== -1) {
          setActiveWordIndex(wordIdx)
        }
      }
    }

    utter.onend = () => {
      stop()
    }

    utter.onerror = () => {
      stop()
    }

    utterRef.current = utter
    speechSynthesis.speak(utter)
    setStatus('playing')
    setActiveWordIndex(0)
    setActiveSentenceId(null)

    startSimulationTimer(words, 0, 0)
  }, [status, selectedVoice, currentPara, words, wordRanges, getWordIndexFromCharIndex, stop, activeSentenceId, startSimulationTimer, speechRate, activeWordIndex])

  // Play a specific sentence
  const playSentence = useCallback((sentenceText, sentenceId) => {
    stop()

    // Find the starting position of this sentence in the full paragraph to shift word index correctly
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
      stop()
    }

    utter.onerror = () => {
      stop()
    }

    utterRef.current = utter
    speechSynthesis.speak(utter)
    setStatus('playing')
    setActiveSentenceId(sentenceId)
    setActiveWordIndex(paragraphWordOffset)

    // Start fallback simulation for this sentence
    startSimulationTimer(sentenceWords, paragraphWordOffset, 0)
  }, [selectedVoice, currentPara, getWordIndexFromCharIndex, stop, startSimulationTimer, speechRate])

  // Pause playback
  const pause = useCallback(() => {
    speechSynthesis.pause()
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current)
      simulationIntervalRef.current = null
    }
    setStatus('paused')
  }, [])

  // Auto-stop speech when switching paragraphs
  useEffect(() => {
    stop()
    setSelectedWord(null)
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
      // Auto scroll vocab card into view if needed
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

  return (
    <div className="app-container">
      {/* Brand Header */}
      <header className="main-header">
        <div className="logo-section">
          <span className="badge">BETA TESTING</span>
          <h1>ബഹുഭാഷാ സഹായി</h1>
          <p className="subtitle">Bilingual Learning Assistant & Voice Tracker</p>
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
                    <label htmlFor="voice-select">Voice:</label>
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
                  {status === 'playing' && (activeSentenceId ? 'Reading selected sentence...' : 'Reading paragraph...')}
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
            <p><strong>Tip for Students:</strong> Click any underlined word in the text above to view its Malayalam meaning and pronunciation guide instantly!</p>
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
          </div>

          {/* Tab Content 1: Sentence by Sentence Translation */}
          {sidebarTab === 'translation' && (
            <div className="tab-pane translation-pane">
              <p className="tab-instruction">ക്ലിക്ക് ചെയ്ത് ഓരോ വാക്യവും പ്രത്യേകം കേൾക്കുക:</p>
              <div className="sentence-list">
                {currentPara.sentences.map((s) => {
                  const isCurrentPlaying = activeSentenceId === s.id && status === 'playing'
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
                          {isCurrentPlaying ? '🔊 Playing' : '🔈 Listen'}
                        </button>
                      </div>
                      <div className="english-sentence">{s.english}</div>
                      <div className="malayalam-sentence">{s.malayalam}</div>
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
        </section>

      </main>

      <footer className="app-footer">
        <p>Bilingual Audio Learning Assistant. Crafted for Kerala State Syllabus & Malayalam speaking learners.</p>
      </footer>
    </div>
  )
}

export default App
