import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AuthLayout({ children, title, description, footer }) {
  return <main className="auth-page"><Link className="auth-back" to="/"><span aria-hidden="true">←</span> Back home</Link><section className="auth-card"><Link to="/" className="marketing-brand auth-brand"><span className="brand-symbol">T</span>teamflow</Link><div className="auth-heading"><h1>{title}</h1><p>{description}</p></div>{children}{footer && <div className="auth-footer">{footer}</div>}</section><p className="auth-security"><ShieldCheck size={15} /> Your workspace is private and secure</p></main>;
}
