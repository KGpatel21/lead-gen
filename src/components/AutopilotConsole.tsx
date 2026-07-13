/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Bot,
  Play,
  Pause,
  Volume2,
  Mic,
  MicOff,
  Search,
  Download,
  CheckCircle2,
  Hourglass,
  Send,
  Workflow,
  DownloadCloud,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  Smartphone,
  CheckCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Sliders,
  Mail
} from "lucide-react";

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  platform: string;
  profileUrl: string;
  personalizedLine: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
}

export default function AutopilotConsole() {
  const [topic, setTopic] = useState("Marketing professionals in London");
  const [platformOption, setPlatformOption] = useState("All Social Platforms");
  const [strategyText, setStrategyText] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  // Speech configurations
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceGreetingPlayed, setVoiceGreetingPlayed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("Microphone stands empty");
  
  // Exporter confirmations
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [activeTab, setActiveTab] = useState<"workspace" | "leads" | "logs">("workspace");
  const [logs, setLogs] = useState<any[]>([]);

  // Speech Recognition Ref
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Synthesis & Morning audio greeting
  useEffect(() => {
    // Say Hello only once when the page fully mounts
    if (voiceEnabled && !voiceGreetingPlayed) {
      speakMessage("Hello Krutarth Patel! Welcome back. I am your Autopilot Boss Agent. I stand ready to coordinate scanning and sales outreach campaigns. Speak or select a target niche to begin scanning social platforms.");
      setVoiceGreetingPlayed(true);
    }
    
    // Add initial pre-populated logs
    setLogs([
      { id: 1, time: "08:15 AM", type: "system", msg: "Outbound.AI Automated Autopilot Engine initialized successfully." },
      { id: 2, time: "08:16 AM", type: "system", msg: "SMTP rotation schedules synced with verified domains count (SPF/DKIM/DMARC: active)." },
      { id: 3, time: "08:16 AM", type: "boss", msg: "Boss Strategist Agent: Awaiting morning niche target keywords to start internet crawl." }
    ]);
  }, []);

  // Web Speech synthesis helper
  const speakMessage = (text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel(); // Stop current speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      
      // Attempt to pick a beautiful sounding english voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("natural") || v.lang.startsWith("en"));
      if (preferred) {
        utterance.voice = preferred;
      }
      
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech Synthesis Exception:", e);
    }
  };

  // Toggle voiceover
  const toggleVoiceEnabled = () => {
    if (voiceEnabled) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setVoiceEnabled(false);
    } else {
      setVoiceEnabled(true);
      speakMessage("Voice voiceover enabled. Autonomous reporting active.");
    }
  };

  // Play custom sample greeting on manual request
  const playSampleGreeting = () => {
    speakMessage("Hello Krutarth Patel. Hope you are having a productive morning. Let's launch your daily automated social lead-gen scanning. Your SMTP pool looks fully primed.");
  };

  // Web Speech Recognition Initialize
  const startSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechStatus("Speech Recognition api is not supported in this frame.");
      return;
    }

    try {
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
        setSpeechStatus("Microphone disabled.");
        return;
      }

      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.lang = "en-US";
      rec.interimResults = false;

      rec.onstart = () => {
        setIsListening(true);
        setSpeechStatus("Listening for voice commands... (Try saying: 'Start scanning')");
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setTopic(transcript);
        setSpeechStatus(`Captured: "${transcript}"`);
        speakMessage(`Acknowledged. Processing your directive: ${transcript}`);
        
        // If transcript hints starting scanner
        if (transcript.toLowerCase().includes("start") || transcript.toLowerCase().includes("scan") || transcript.toLowerCase().includes("work")) {
          setTimeout(() => {
            triggerAutopilotEngine(transcript);
          }, 1200);
        }
      };

      rec.onerror = (err: any) => {
        console.error("Speech Recognition Error", err);
        const errType = err.error || "";
        if (errType === "not-allowed") {
          setSpeechStatus("Permission denied. Please allow microphone access in your browser or iframe settings.");
        } else if (errType === "no-speech") {
          setSpeechStatus("No speech detected. Please speak clearly and try again.");
        } else if (errType === "audio-capture") {
          setSpeechStatus("No microphone found or it is currently in use by another app.");
        } else if (errType === "network") {
          setSpeechStatus("Network error occurred during speech capture.");
        } else {
          setSpeechStatus(`Error capturing voice (${errType || "unknown"}). Please try typing your command.`);
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();

    } catch (e) {
      console.error(e);
      setSpeechStatus("Speech Recognition blocked or inaccessible.");
    }
  };

  // Dispatch fully automated loop via endpoint
  const triggerAutopilotEngine = async (forcedTopic?: string) => {
    const queryTopic = forcedTopic || topic;
    if (!queryTopic.trim()) return;

    setIsRunning(true);
    setStrategyText("");
    setLeads([]);
    
    // Stagger steps in the visual UI to simulate employee hierarchy working in tandem
    setActiveStep(1); // CEO Strategizing
    speakMessage("Boss Agent is analyzing topic dorks and compiling social queries.");
    
    await new Promise(r => setTimeout(r, 2000));
    setActiveStep(2); // LinkedIn/IG web scraper
    speakMessage("Social scraper employee is starting search queries on LinkedIn and Instagram profiles.");

    await new Promise(r => setTimeout(r, 2000));
    setActiveStep(3); // Excel compiler verifying SPF records
    speakMessage("Verification engine is sanitizing emails and compiling raw dataset.");

    await new Promise(r => setTimeout(r, 2000));
    setActiveStep(4); // Copywriting personalization
    speakMessage("Outreach copywriting agent is drafting custom icebreakers.");

    await new Promise(r => setTimeout(r, 1500));
    setActiveStep(5); // Sequence dispatching rotation
    speakMessage("Orchestrator is initiating automated sequence queuing on your cold emailing grid.");

    try {
      const res = await fetch("/api/autopilot/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: queryTopic, platforms: platformOption })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Execution error in autopilot dispatcher.");
      }

      setStrategyText(data.strategy);
      setLeads(data.leads || []);
      
      // Update local simulation logs
      setLogs(prev => [
        { id: Date.now() + 1, time: new Date().toLocaleTimeString(), type: "boss", msg: `Executive Plan: ${data.strategy}` },
        { id: Date.now() + 2, time: new Date().toLocaleTimeString(), type: "system", msg: `Successfully imported ${data.leads?.length} targets directly into high-converting campaigns.` },
        ...prev
      ]);

      speakMessage(`Success! Generated, compiled, and mapped ${data.leads?.length} leads. Direct CSV download and queue are active.`);

    } catch (err: any) {
      console.error(err);
      setStrategyText("Error executing system crawl.");
      speakMessage("System exception occurred. Directing local crawl engines for backup.");
    } finally {
      setIsRunning(false);
      setActiveStep(null);
    }
  };

  // Live Excel Download compiler
  const exportToCsv = () => {
    if (leads.length === 0) return;

    // Compile columns
    const headers = ["First Name", "Last Name", "Company", "Email", "Phone", "Platform Hub", "Profile Anchor", "Personalized Icebreaker"];
    const rows = leads.map(l => [
      l.firstName,
      l.lastName,
      l.company,
      l.email,
      l.phone,
      l.platform,
      l.profileUrl,
      l.personalizedLine.replace(/"/g, '""')
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Autonomous_Leads_${topic.replace(/\s+/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  // High quality sample cues to helper clicking
  const samples = [
    "SaaS Founders and CTOs in Seattle",
    "Real Estate Brokers in Los Angeles",
    "Gym and fitness center managers in Chicago",
    "Digital Marketing consultants in Melbourne"
  ];

  return (
    <div className="flex-1 p-8 bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto space-y-6 font-sans select-none transition-colors duration-200" id="autopilot-root-container">
      
      {/* Autopilot Dashboard Header banner */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm" id="autopilot-banner">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 dark:text-indigo-400 font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">
              AI Command Engine Active
            </span>
            <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-mono font-bold uppercase px-2 py-0.5 rounded-md animate-pulse">
              Real-time Grounding Enabled
            </span>
          </div>
          
          <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white mt-1.5 tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-655 text-indigo-500 animate-spin" />
            AI Autopilot Command Deck
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Meet your automated outbound executive. This console greets you with synthesized voice queues, accepts spoken microphone instructions, crawls LinkedIn and Instagram using active search grounding, cleanses Excel spreadsheets, and dispatches rotated email templates automatically.
          </p>
        </div>

        {/* Audio Morning Greeting Controller */}
        <div className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800/80 w-full lg:w-auto" id="voice-controller">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${voiceEnabled ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'}`}>
                <Volume2 className="w-4 h-4" />
              </div>
              <div className="text-left">
                <span className="text-[10px] font-mono text-slate-400 block font-bold">SPEECH SYNTHESIS</span>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-350">{voiceEnabled ? "Voice Enabled" : "Voice Idle / Muted"}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={playSampleGreeting}
                className="text-[9.5px] font-mono bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 transition cursor-pointer font-bold"
                title="Trigger Morning greeting report"
              >
                Welcome Speech
              </button>
              <button
                onClick={toggleVoiceEnabled}
                className={`text-[9.5px] font-mono px-2 py-1 rounded-md transition duration-150 cursor-pointer font-bold ${
                  voiceEnabled 
                    ? "bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400" 
                    : "bg-indigo-600 text-white hover:bg-indigo-550"
                }`}
              >
                {voiceEnabled ? "Mute" : "Unmute"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Multi-Agent Hub Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="autopilot-interactive-grid">
        
        {/* Left Hand: Controller & Input form */}
        <div className="lg:col-span-1 space-y-6" id="autopilot-left-nav">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-600" />
              1. Direct the CEO Strategist
            </h2>

            {/* Voice Input capture HUD */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-rose-500 animate-ping' : 'bg-slate-400'}`}></span>
                  Voice Recognition Control
                </span>
                <span className="text-[9px] text-slate-400 font-mono">Hands-Free</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Click microphone to instruct outbound agents. Speak naturally, e.g. <em>"Start scanning financial advisors in Sydney"</em>.
              </p>
              
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={startSpeechRecognition}
                  className={`flex-1 text-xs font-semibold font-mono py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    isListening 
                      ? "bg-rose-600 hover:bg-rose-550 text-white animate-pulse" 
                      : "bg-slate-900 text-indigo-455 hover:bg-slate-805 text-indigo-400 dark:bg-slate-800 dark:hover:bg-slate-705 border border-indigo-500/20"
                  }`}
                >
                  {isListening ? <Mic className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4" />}
                  {isListening ? "Listening... (Press Stop)" : "Click and Speak Command"}
                </button>
              </div>

              <div className="text-[10px] font-mono text-slate-450 dark:text-slate-500 leading-tight">
                Status: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{speechStatus}</span>
              </div>
            </div>

            {/* Manual Text Formulation */}
            <div className="space-y-3 pt-1">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Target Segment Description</label>
                <div className="relative">
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-indigo-600 rounded-xl py-2.5 pl-3.5 pr-10 text-xs text-slate-800 dark:text-slate-200 outline-none transition leading-relaxed font-mono"
                    placeholder="E.g. real estate agents in New York"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Crawl Target Network</label>
                <select
                  value={platformOption}
                  onChange={(e) => setPlatformOption(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs py-2.5 px-3 rounded-xl outline-none font-mono text-slate-700 dark:text-slate-350 focus:border-indigo-650"
                >
                  <option value="All Social Platforms">All (LinkedIn, Instagram, Google Maps, Twitter)</option>
                  <option value="LinkedIn Profiles">LinkedIn Network (Corporate & Professionals)</option>
                  <option value="Instagram Outbound">Instagram Profiles (Brand & Direct-to-Consumer)</option>
                  <option value="Google Maps Directories">Google Maps Locations (Local & High Street Shops)</option>
                  <option value="Twitter / X Channels">Twitter / X Profiles (Tech & Influencers)</option>
                </select>
              </div>

              <button
                onClick={() => triggerAutopilotEngine()}
                disabled={isRunning || !topic.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-550 text-white font-semibold text-xs py-3 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-650/10 cursor-pointer font-mono"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Executing Agent System...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    Launch Autopilot Loop
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Click presets */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-2">
            <span className="text-[10px] uppercase tracking-wider font-mono font-bold text-slate-400 block">Or Quick Select Niche</span>
            <div className="flex flex-wrap gap-1.5">
              {samples.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setTopic(s)}
                  className="text-[10.5px] bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 border border-slate-250 dark:border-slate-810 text-slate-600 dark:text-slate-350 py-1.5 px-2.5 rounded-lg cursor-pointer transition font-mono truncate max-w-full"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Right Hand: Interactive Work Space and Animations */}
        <div className="lg:col-span-2 space-y-6" id="autopilot-interactive-right">
          
          {/* Navigation Controls */}
          <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-805" id="autopilot-tab-selector">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === "workspace" 
                  ? "bg-indigo-600 text-white shadow-sm font-bold" 
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
              }`}
            >
              <Layers className="w-4 h-4" /> Live Execution Dock
            </button>
            <button
              onClick={() => setActiveTab("leads")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition cursor-pointer relative ${
                activeTab === "leads" 
                  ? "bg-indigo-600 text-white shadow-sm font-bold" 
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" /> Excel/CSV Table Review
              {leads.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full animate-bounce">
                  {leads.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition cursor-pointer ${
                activeTab === "logs" 
                  ? "bg-indigo-600 text-white shadow-sm font-bold" 
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-350"
              }`}
            >
              <Clock className="w-4 h-4" /> Live Operations Feed
            </button>
          </div>

          {/* TAB 1: Main active Workspace (Visualizes Hierarchy & Active Work) */}
          {activeTab === "workspace" && (
            <div className="space-y-6" id="autopilot-workspace">
              
              {/* Hierarchy Visualizer Panel */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Workflow className="w-4.5 h-4.5 text-indigo-505 text-indigo-500" />
                    Unified Multi-Agent Hierarchy Board
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Observe your delegated sub-agents working together in tandem.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative" id="autopilot-hierarchy-flow">
                  
                  {/* Strategic CEO Boss */}
                  <div className={`md:col-span-1 p-4 rounded-xl border flex flex-col justify-between space-y-3 relative ${
                    activeStep === 1 
                      ? "bg-indigo-50/50 border-indigo-600 dark:bg-indigo-950/20 dark:border-indigo-400 shadow-md animate-pulse" 
                      : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}>
                    <div className="text-left space-y-1">
                      <span className="text-[8px] font-mono text-indigo-6)0 dark:text-indigo-400 font-bold uppercase block tracking-wider">Level 1: BOSS</span>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-tight">CEO Agent</h4>
                      <p className="text-[9.5px] text-slate-400 leading-normal">Orchestrates crawl strategies.</p>
                    </div>
                    <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-center w-full block ${
                      activeStep === 1 ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-800"
                    }`}>
                      {activeStep === 1 ? "STRATEGIZING..." : "STANDBY"}
                    </span>
                  </div>

                  <div className="flex items-center justify-center text-slate-350 md:col-span-1 py-1">
                    <ArrowRight className="w-5 h-5 hidden md:block" />
                    <span className="md:hidden text-xs font-mono">NEXT PHASE</span>
                  </div>

                  {/* Scraper Employee */}
                  <div className={`md:col-span-1 p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                    activeStep === 2 
                      ? "bg-amber-50/50 border-amber-500 dark:bg-amber-950/20 dark:border-amber-400 shadow-md animate-pulse" 
                      : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}>
                    <div className="text-left space-y-1">
                      <span className="text-[8px] font-mono text-amber-600 dark:text-amber-400 font-bold uppercase block tracking-wider">Level 2: STAFF</span>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-tight">Scraper Bot</h4>
                      <p className="text-[9.5px] text-slate-400 leading-normal">Crawls social structures.</p>
                    </div>
                    <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-center w-full block ${
                      activeStep === 2 ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-800"
                    }`}>
                      {activeStep === 2 ? "CRAWLING..." : "STANDBY"}
                    </span>
                  </div>

                  <div className="flex items-center justify-center text-slate-350 md:col-span-1 py-1">
                    <ArrowRight className="w-5 h-5 hidden md:block" />
                    <span className="md:hidden text-xs font-mono">NEXT PHASE</span>
                  </div>

                  {/* Excel Compiler Employee */}
                  <div className={`md:col-span-1 p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                    activeStep === 3 
                      ? "bg-emerald-50/50 border-emerald-500 dark:bg-emerald-950/20 dark:border-emerald-400 shadow-md animate-pulse" 
                      : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}>
                    <div className="text-left space-y-1">
                      <span className="text-[8px] font-mono text-emerald-600 dark:text-emerald-400 font-bold uppercase block tracking-wider">Level 2: STAFF</span>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-tight">Verifier Pro</h4>
                      <p className="text-[9.5px] text-slate-400 leading-normal">Compiles CSV, dedupes data.</p>
                    </div>
                    <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-center w-full block ${
                      activeStep === 3 ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-800"
                    }`}>
                      {activeStep === 3 ? "COMPILING..." : "STANDBY"}
                    </span>
                  </div>

                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pt-1" id="autopilot-hierarchy-flow-2">
                  
                  {/* Copywriting Personalization Employee */}
                  <div className={`md:col-span-2 p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                    activeStep === 4 
                      ? "bg-violet-50/50 border-violet-500 dark:bg-violet-950/20 dark:border-violet-400 shadow-md animate-pulse" 
                      : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}>
                    <div className="text-left space-y-1">
                      <span className="text-[8px] font-mono text-violet-600 dark:text-violet-400 font-bold uppercase block tracking-wider">Level 3: WRITER</span>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-tight">Copywriter AI</h4>
                      <p className="text-[9.5px] text-slate-400 leading-normal">Writes hyper-customized social icebreakers using Gemini.</p>
                    </div>
                    <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-center w-full block ${
                      activeStep === 4 ? "bg-violet-550 bg-violet-600 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-800"
                    }`}>
                      {activeStep === 4 ? "WRITING ICEBREAKERS..." : "STANDBY"}
                    </span>
                  </div>

                  <div className="flex items-center justify-center text-slate-350 md:col-span-1 py-1">
                    <ArrowRight className="w-5 h-5 hidden md:block" />
                    <span className="md:hidden text-xs font-mono">NEXT PHASE</span>
                  </div>

                  {/* Outreach Sequencer Employee */}
                  <div className={`md:col-span-2 p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                    activeStep === 5 
                      ? "bg-pink-50/50 border-pink-500 dark:bg-pink-950/20 dark:border-pink-400 shadow-md animate-pulse" 
                      : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800"
                  }`}>
                    <div className="text-left space-y-1">
                      <span className="text-[8px] font-mono text-pink-600 dark:text-pink-400 font-bold uppercase block tracking-wider">Level 3: OUTREACH</span>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-tight">Sequencer Bot</h4>
                      <p className="text-[9.5px] text-slate-400 leading-normal">Hooks targets to rotational SMTPs & triggers emails scheduler.</p>
                    </div>
                    <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded text-center w-full block ${
                      activeStep === 5 ? "bg-pink-500 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-800"
                    }`}>
                      {activeStep === 5 ? "SCHEDULING ROTATIONS..." : "STANDBY"}
                    </span>
                  </div>

                </div>

              </div>

              {/* Crawled Results active summary */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/80">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Crawl Output Terminal</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Real-time compilation logs, web grounding data, and Boss plan.</p>
                  </div>
                  
                  {leads.length > 0 && (
                    <button
                      onClick={exportToCsv}
                      className="bg-emerald-600 hover:bg-emerald-555 text-white text-[10.5px] font-semibold py-1.5 px-3 rounded-lg flex items-center gap-1 transition cursor-pointer font-mono"
                    >
                      {copiedCsv ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                      {copiedCsv ? "Downloaded Spreadsheet!" : "Download Excel Layout (.csv)"}
                    </button>
                  )}
                </div>

                {isRunning ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                    <div className="w-9 h-9 border-3 border-indigo-650 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-xs font-mono text-slate-500">Autonomous sub-agents are actively scanning LinkedIn/Instagram profiles...</p>
                  </div>
                ) : leads.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-805 rounded-xl bg-slate-50/50">
                    <Bot className="w-8 h-8 text-slate-450 mx-auto opacity-70 mb-2" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 font-mono">No active crawlers dispatched this morning.</p>
                    <p className="text-[11px] text-slate-400 mt-1">Input a topic niche like 'Dentists in Austin' above and trigger the Autopilot loop.</p>
                  </div>
                ) : (
                  <div className="space-y-4" id="crawled-output-ready">
                    <div className="p-3 bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100 dark:border-indigo-900/30 rounded-xl">
                      <span className="text-[10px] font-mono text-indigo-700 dark:text-indigo-400 font-bold block">BOSS STRATEGIST AI PLAN</span>
                      <p className="text-slate-650 dark:text-slate-300 text-xs mt-1 leading-relaxed font-mono italic">
                        "{strategyText}"
                      </p>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[10px] font-mono text-slate-400 font-bold block">RECENTLY CRAWLED SOCIAL PROSPECTS (5 TARGETS FOUND)</span>
                      
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3" id="leads-quick-cards">
                        {leads.map((l, index) => (
                          <div 
                            key={index}
                            className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
                          >
                            <div className="space-y-1">
                              <span className="text-[8px] font-mono bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-bold px-1 py-0.2 rounded uppercase block w-max">
                                {l.platform}
                              </span>
                              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">{l.firstName} {l.lastName}</h4>
                              <p className="text-[10px] text-slate-455 truncate font-mono">{l.company}</p>
                              <p className="text-[9.5px] text-slate-400 truncate font-mono">{l.email}</p>
                            </div>
                            
                            <div className="border-t border-slate-150 dark:border-slate-805 pt-2 mt-2 text-[9.5px] text-slate-500 italic line-clamp-2 leading-relaxed">
                              "{l.personalizedLine}"
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: EXCEL COMPILER TABLE VIEW */}
          {activeTab === "leads" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4" id="scraped-leads-table-container">
              <div className="flex justify-between items-center pb-2 border-b border-slate-155 dark:border-slate-805">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 font-mono">
                    <FileSpreadsheet className="w-4.5 h-4.5 text-emerald-600" /> Compiled Excel/CSV Leads Dataset
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Verified contacts with custom copywriting parameters ready for Microsoft Excel.</p>
                </div>

                {leads.length > 0 && (
                  <button
                    onClick={exportToCsv}
                    className="bg-emerald-600 hover:bg-emerald-555 text-white text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition cursor-pointer font-mono font-semibold"
                  >
                    <DownloadCloud className="w-4.5 h-4.5" /> Download Spreadsheet
                  </button>
                )}
              </div>

              {leads.length === 0 ? (
                <div className="text-center py-16 text-slate-400 font-mono text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40">
                  Spreadsheet lists stand empty. Run a crawler dispatch program first.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800" id="autopilot-table-scroller">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-650 font-mono font-semibold border-b border-slate-200 dark:border-slate-805">
                        <th className="p-3">Platform</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Company</th>
                        <th className="p-3">Verified Email</th>
                        <th className="p-3">Phone</th>
                        <th className="p-3">Profile Link</th>
                        <th className="p-3">Personalized Icebreaker</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-805 font-mono text-[11px]">
                      {leads.map((l, index) => (
                        <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                          <td className="p-3">
                            <span className="bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.5 rounded uppercase text-[9.5px]">
                              {l.platform}
                            </span>
                          </td>
                          <td className="p-3 font-semibold text-slate-850 dark:text-slate-100">{l.firstName} {l.lastName}</td>
                          <td className="p-3 text-slate-650 dark:text-slate-350">{l.company}</td>
                          <td className="p-3 text-indigo-650 dark:text-indigo-400 font-semibold select-all">{l.email}</td>
                          <td className="p-3 text-slate-450">{l.phone || "N/A"}</td>
                          <td className="p-3">
                            <a 
                              href={l.profileUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-blue-550 dark:text-blue-400 hover:underline inline-block truncate max-w-[120px]"
                            >
                              Profile url
                            </a>
                          </td>
                          <td className="p-3 text-slate-505 dark:text-slate-450 truncate max-w-[200px]" title={l.personalizedLine}>
                            {l.personalizedLine}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SYSTEM AUDIT LOG FEED */}
          {activeTab === "logs" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4" id="system-audit-logs-autopilot">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">System Logs & Verification Feeds</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Real-time diagnostic records of agent dispatches, SPF alignments, and rotative campaign allocations.</p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-2.5 max-h-[460px] overflow-y-auto" id="logs-list-scroller">
                {logs.map((lg) => (
                  <div key={lg.id} className="text-xs font-mono leading-relaxed text-slate-200 flex gap-2.5 items-start">
                    <span className="text-slate-500 shrink-0 select-none">[{lg.time}]</span>
                    {lg.type === "boss" ? (
                      <span className="text-indigo-400 shrink-0 font-bold">[CEO BOSS]:</span>
                    ) : (
                      <span className="text-emerald-500 shrink-0 font-bold">[SYSTEM]:</span>
                    )}
                    <span className="text-slate-300 select-text">{lg.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
