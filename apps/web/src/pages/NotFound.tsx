import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";

export function NotFound({ what = "There is no page at this address.", back = { to: "/", label: "Home" } }: { what?: string; back?: { to: string; label: string } }) {
  return (
    <div className="page placeholder">
      <h1 className="lead">{what}</h1>
      <p>
        <Link className="link-arrow" to={back.to}>
          <Icon name="arrow-left" /> {back.label}
        </Link>
      </p>
    </div>
  );
}
