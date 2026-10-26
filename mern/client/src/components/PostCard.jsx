import { niceDate, niceTime } from "../format.js";
import { Badge } from "./ui.jsx";
import { useT } from "../i18n.jsx";

export default function PostCard({ post, children }) {
  const t = useT();
  return (
    <article className="post">
      {post.photo && <a href={`/api/news/${post.id}/photo`} target="_blank" rel="noreferrer"><img src={`/api/news/${post.id}/photo`} alt="" loading="lazy" /></a>}
      <div className="post-body">
        <div className="post-meta">
          <Badge tone={post.kind === "offer" ? "ok" : "info"}>{t(post.kind_label)}</Badge>
          <span className="muted small">{niceTime(post.created_at)}</span>
        </div>
        <h3>{post.title}</h3>
        {post.body && <p className="post-text">{post.body}</p>}
        {post.until && <div className="small strong">{t("Valid till {d}", { d: niceDate(post.until) })}</div>}
        {children}
      </div>
    </article>
  );
}
