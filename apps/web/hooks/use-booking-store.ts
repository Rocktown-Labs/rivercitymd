import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'



interface Vehicle {
  year: string
  make: string
  model: string
  color?: string
  licensePlate?: string
  size?: "small" | "medium" | "large"
  vehicleTypeId?: string
  vehicleTypeName?: string
  classification?: {
    source: "fuelEconomy" | "vpic" | "manual" | "fallback"
    confidence: "high" | "medium" | "low"
    rawCategory?: string
    needsAdminReview: boolean
  }
  hasPet?: boolean
  hasHeavySoil?: boolean
  beforePhotos?: Array<{
    key: string
    fileName: string
    contentType: string
    sizeBytes: number
    uploadedAt: number
  }>
}

interface Step1Data {
  scheduledDate: Date // stored as string in JSON, revived as string usually unless custom revive
  scheduledTime: string
  street: string
  city: string
  state: string
  zip?: string
  locationNotes?: string
  latitude?: number
  longitude?: number
}

interface Step2Data {
  name: string
  phone: string
  email: string
  smsOptIn: boolean
  marketingEmails?: boolean
}

interface Step3Data {
  vehicles: Vehicle[]
}

interface Step4Data {
  serviceIds: string[]
  vehicleServices?: Record<string, string[]>
}

interface BookingStore {
  currentStep: number
  resumeToken: string | null
  step1Data: Step1Data | null
  step2Data: Step2Data | null
  step3Data: Step3Data | null
  step4Data: Step4Data | null
  
  // Actions
  setCurrentStep: (step: number) => void
  setResumeToken: (token: string | null) => void
  setStep1Data: (data: Step1Data) => void
  setStep2Data: (data: Step2Data) => void
  setStep3Data: (data: Step3Data) => void
  setStep4Data: (data: Step4Data) => void
  hydrateFromDraft: (data: {
    token: string
    step1Data: Step1Data
    step2Data: Step2Data
    step3Data: Step3Data
    step4Data: Step4Data
  }) => void
  resetBooking: () => void
}

export const useBookingStore = create<BookingStore>()(
  persist(
    (set) => ({
      currentStep: 1,
      resumeToken: null,
      step1Data: null,
      step2Data: null,
      step3Data: null,
      step4Data: null,

      setCurrentStep: (step) => set({ currentStep: step }),
      setResumeToken: (token) => set({ resumeToken: token }),
      setStep1Data: (data) => set({ step1Data: data }),
      setStep2Data: (data) => set({ step2Data: data }),
      setStep3Data: (data) => set({ step3Data: data }),
      setStep4Data: (data) => set({ step4Data: data }),
      hydrateFromDraft: (data) =>
        set({
          resumeToken: data.token,
          currentStep: 1,
          step1Data: data.step1Data,
          step2Data: data.step2Data,
          step3Data: data.step3Data,
          step4Data: data.step4Data,
        }),
      resetBooking: () => set({
        currentStep: 1,
        resumeToken: null,
        step1Data: null,
        step2Data: null,
        step3Data: null,
        step4Data: null
      })
    }),
    {
      name: 'booking-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Don't persist sensitive UI state if we add any, but persist data
        currentStep: state.currentStep,
        resumeToken: state.resumeToken,
        step1Data: state.step1Data,
        step2Data: state.step2Data,
        step3Data: state.step3Data,
        step4Data: state.step4Data
      })
    }
  )
)
