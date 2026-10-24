import type { ShellerApi } from '../../shared/types'

declare global {
  interface Window {
    sheller: ShellerApi
  }
}

export {}
