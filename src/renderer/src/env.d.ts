import type { ShellerApi, UpdaterApi } from '../../shared/types'

declare global {
  interface Window {
    sheller: ShellerApi
    updater: UpdaterApi
  }
}

export {}
