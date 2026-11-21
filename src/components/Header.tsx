import { CircleHelp, FileInput, Home, Layers3, Workflow } from 'lucide-react'

const navigation = [
  { label: 'Home', href: '#home', icon: Home },
  { label: 'Convert GST Files', href: '#convert', icon: FileInput },
  { label: 'Supported Marketplaces', href: '#marketplaces', icon: Layers3 },
  { label: 'How It Works', href: '#how-it-works', icon: Workflow },
  { label: 'Help', href: '#help', icon: CircleHelp },
]

function Header() {
  return (
    <aside className="sidebar">
      <a className="brand" href="#home" aria-label="GSTBridge home">
        <img className="brand-mark" src="/logo.svg" alt="" />
        <span className="brand-name">GSTBridge</span>
      </a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {navigation.map(({ label, href, icon: Icon }, index) => (
          <a className={`nav-link${index === 0 ? ' active' : ''}`} href={href} key={label}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-security"><span className="security-dot" />Secure, local processing</div>
        <p>Your sales files stay on this device.</p>
        <div className="sidebar-version">GSTBridge <span>v1.0</span></div>
      </div>
    </aside>
  )
}

export default Header
