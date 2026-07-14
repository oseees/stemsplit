export interface TripContext {
  id: string
  destination: string
  departureCity: string
  startDate: string
  endDate: string
  currency: string
  budget: number
  travelers: number
  nightsCount: number
  expenses: { category: string; amount: number; date: string; notes?: string | null }[]
  selectedFlight?: { price: number; currency: string; airline: string; durationMin: number } | null
  selectedHotel?: { price: number; currency: string; name: string; nights: number } | null
}

export interface CategoryAnalysis {
  category: string
  estimated: number
  actual: number
  percentage: number
  status: "under" | "on_track" | "over"
  note?: string
}

export interface Recommendation {
  type: string
  title: string
  savings: number
  confidence: number
  reasoning: string
  priority: number
}

export interface ExpensePrediction {
  food: number
  transport: number
  activities: number
  shopping: number
  emergency: number
  total: number
  currency: string
}

export interface DestinationSuggestion {
  name: string
  country: string
  estimatedCost: number
  currency: string
  weather: string
  popularity: "low" | "medium" | "high"
  savings: number
  highlights: string[]
}

export interface TripAnalysisResult {
  score: number
  health: "excellent" | "good" | "fair" | "poor"
  summary: string
  categories: CategoryAnalysis[]
  recommendations: Recommendation[]
  predictions: ExpensePrediction
  alternativeDestinations: DestinationSuggestion[]
  notifications: string[]
  projectedTotal: number
  potentialSavings: number
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}
