export default function Button({ children, variant = 'primary', size = '', className = '', type = 'button', ...props }) {
  return <button className={`button button-${variant} ${size ? `button-${size}` : ''} ${className}`.trim()} type={type} {...props}>{children}</button>;
}
