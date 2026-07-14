"use client"

import { useState, useRef, useEffect } from "react"
import type { ChatMessage } from "@/lib/ai/types"

interface Props {
  tripId?: string
  tripLabel?: string
}

export default function ChatInterface({ tripId, tripLabel }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setLoading(true)

    const userMsg: ChatMessage = { role: "user", content: text }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsg: ChatMessage = { role: "assistant", content: "" }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId, tripId }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error)
      }

      // Read conversation ID from header
      const convId = res.headers.get("X-Conversation-Id")
      if (convId) setConversationId(convId)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let first = true
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)

        // First chunk contains JSON meta terminated by \x00\n
        if (first) {
          buffer += chunk
          const sep = buffer.indexOf("\x00\n")
          if (sep !== -1) {
            buffer = buffer.slice(sep + 2)
            first = false
          }
          // Flush remainder as AI text
          if (!first && buffer) {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { role: "assistant", content: buffer }
              return next
            })
          }
          continue
        }

        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + chunk }
          return next
        })
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Something went wrong"
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: "assistant", content: `Error: ${errMsg}` }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const suggestions = [
    "Can I extend my trip by 2 days?",
    "Where can I save the most money?",
    "How much should I budget for food?",
    "Is my hotel too expensive?",
  ]

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-96 flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold">AI</div>
        <div>
          <p className="text-sm font-medium text-slate-800">RouteWise AI</p>
          {tripLabel && <p className="text-xs text-slate-500">Context: {tripLabel}</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="card bg-brand-50 border-brand-200">
              <p className="text-sm text-brand-700">
                👋 Hi! I&apos;m RouteWise AI. Ask me anything about your trip — budget advice, destination tips, cost breakdowns, or itinerary ideas.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setInput(s) }} className="card text-left text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
              m.role === "user"
                ? "bg-brand-600 text-white"
                : "bg-white border border-slate-200 text-slate-700"
            }`}>
              {m.content || (loading && i === messages.length - 1 ? (
                <span className="flex gap-1">
                  <span className="animate-bounce">•</span>
                  <span className="animate-bounce [animation-delay:0.1s]">•</span>
                  <span className="animate-bounce [animation-delay:0.2s]">•</span>
                </span>
              ) : "")}
              {loading && i === messages.length - 1 && m.content && (
                <span className="inline-block h-3 w-0.5 animate-pulse bg-slate-400 ml-0.5 align-middle" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask anything about your trip…"
          className="field flex-1"
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !input.trim()} className="btn-primary">
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  )
}
