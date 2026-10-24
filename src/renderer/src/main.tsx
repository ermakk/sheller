import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import App from './App'
import DetachedApp from './DetachedApp'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const detached = params.get('detached')
const profileId = params.get('profileId')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  detached && profileId ? (
    <DetachedApp sessionId={detached} profileId={profileId} />
  ) : (
    <App />
  )
)