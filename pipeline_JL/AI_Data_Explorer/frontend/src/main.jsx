import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Theme accentColor="sky" appearance="dark">
      <App />
    </Theme>
  </StrictMode>,
)
