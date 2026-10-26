import { niceDate, niceTime } from "../format.js";
import { Badge } from "./ui.jsx";

export default function PostCard({ post, children }) {
  return (
    <article className="post">
      {post.photo && <a href={`/api/news/${post.id}/photo`} target="_blank" rel="noreferrer"><img src={`/api/news/${post.id}/photo`} alt="" loading="lazy" /></a>}
      <div className="post-body">
        <div className="post-meta">
          <Badge tone={post.kind === "offer" ? "ok" : "info"}>{post.kind_label}</Badge>
          <span className="muted small">{niceTime(post.created_at)}</span>
        </div>
        <h3>{post.title}</h3>
        {post.body && <p className="post-text">{post.body}</p>}
        {post.until && <div className="small strong">Valid till {niceDate(post.until)}</div>}
        {children}
      </div>
    </article>
  );
}
