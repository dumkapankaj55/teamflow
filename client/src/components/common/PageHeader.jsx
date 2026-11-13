export default function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow page-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</div>;
}
