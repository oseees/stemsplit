export const ANALYZE_PROMPT = `You are a travel budget analyst. Analyze this trip and return ONLY valid JSON — no markdown fences, no explanation.

Trip: {context}

Return exactly this structure:
{
  "score": <integer 0-100, higher is healthier>,
  "health": "<excellent|good|fair|poor>",
  "summary": "<2-3 sentence overview of budget health>",
  "categories": [
    {
      "category": "<Flights|Accommodation|Food|Transport|Activities|Shopping|Accessories|Miscellaneous|Insurance|Visa>",
      "estimated": <reasonable estimate for this trip in trip currency>,
      "actual": <amount already spent in this category>,
      "percentage": <integer 0-100 of total budget this category uses>,
      "status": "<under|on_track|over>",
      "note": "<optional short tip>"
    }
  ],
  "recommendations": [
    {
      "type": "<flight|hotel|timing|transport|food|general>",
      "title": "<short actionable recommendation>",
      "savings": <estimated savings in trip currency>,
      "confidence": <0.0-1.0>,
      "reasoning": "<why this saves money>",
      "priority": <1-5, 5 = most important>
    }
  ],
  "predictions": {
    "food": <estimated food cost for full trip in trip currency>,
    "transport": <local transport for full trip>,
    "activities": <entertainment and activities>,
    "shopping": <shopping estimate>,
    "emergency": <10% of budget as safety fund>,
    "total": <sum of all predictions>,
    "currency": "<trip currency>"
  },
  "alternativeDestinations": [
    {
      "name": "<city>",
      "country": "<country>",
      "estimatedCost": <total trip cost estimate in trip currency>,
      "currency": "<trip currency>",
      "weather": "<brief weather note>",
      "popularity": "<low|medium|high>",
      "savings": <amount saved vs current destination>,
      "highlights": ["<3-4 key features>"]
    }
  ],
  "notifications": ["<short actionable alert>"],
  "projectedTotal": <flight + hotel + predictions.total + actual expenses so far>,
  "potentialSavings": <sum of top 3 recommendation savings>
}

Return 5-8 categories, 3-5 recommendations, 2-3 alternative destinations, 2-4 notifications. Be realistic with numbers.`

export const CHAT_SYSTEM_PROMPT = `You are RouteWise AI, a friendly and practical travel budget assistant. Keep answers concise and actionable.

Current trip context: {context}

When asked "can I afford X?", calculate it against their remaining budget. Give specific numbers. If they ask for alternatives, be concrete. Focus on saving money while maximising travel experience.`

export const ITINERARY_PROMPT = `Create a detailed day-by-day travel itinerary for {destination} — {nights} nights starting {startDate}, for {travelers} traveller(s) on a budget of {budget}.

Format each day exactly like this (keep the exact headings and emojis):

## Day 1 — [Day of week, Month DD]

**Morning:** [Activity with brief description and rough cost]
**Afternoon:** [Activity with brief description and rough cost]
**Evening:** [Dinner + evening activity with brief description]

🍽️ **Restaurants:** [2-3 suggestions with price range, e.g. "Trattoria Da Mario (€€)"]
🚌 **Transport:** [How to get around today, estimated cost]
💰 **Estimated daily cost:** [amount and currency] per person
📍 **Walking:** ~[km]km total

---

Repeat for all {nights} days. Include a mix of must-see sights and local gems. Mention specific attraction names, neighbourhoods, and dishes. Keep daily costs within the overall budget.`

export const DESTINATIONS_PROMPT = `A traveller is looking for: "{prompt}" with a budget of {budget}.

Suggest 5 matching destinations and return ONLY valid JSON — no markdown, no explanation:
[
  {
    "name": "<city>",
    "country": "<country>",
    "estimatedCost": <realistic total trip cost for 7 nights 2 people in USD>,
    "currency": "USD",
    "weather": "<brief weather description matching the trip vibe>",
    "popularity": "<low|medium|high>",
    "savings": <how much under budget this destination is, or 0 if near budget>,
    "highlights": ["<feature 1 matching the request>", "<feature 2>", "<feature 3>"]
  }
]

Match the vibe and budget accurately. Be specific and realistic.`
