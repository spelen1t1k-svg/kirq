import Link from "next/link";

export function Logo({ sub = true }: { sub?: boolean }) {
  return (
    <Link href="/" className="kq-logo" style={{ color: "inherit" }}>
      <span className="kq-logo-mark" aria-hidden>
        <i /> <i /> <i className="off" /> <i />
      </span>
      <span className="kq-logo-word">KIRQ</span>
      {sub && <span className="kq-logo-sub">KIRKA PUGS</span>}
    </Link>
  );
}
