import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import DashboardLogin from './pages/DashboardLogin'
import Dashboard from './pages/Dashboard'
import OpportunityDetail from './pages/OpportunityDetail'

function Fade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<Fade><DashboardLogin /></Fade>} />
        <Route path="/" element={<Fade><Dashboard /></Fade>} />
        <Route path="/opp/:id" element={<Fade><OpportunityDetail /></Fade>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
