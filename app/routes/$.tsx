import { Link } from "react-router";

export function meta() {
  return [
    { title: "Page not found: SafeSignal" },
    {
      name: "description",
      content: "This page does not exist. Go back to SafeSignal.",
    },
  ];
}

export default function NotFound() {
  return (
    <div className="safesignal-page mx-auto max-w-3xl space-y-6 overflow-x-clip px-4 py-6">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground text-sm">
        The page you asked for does not exist.
      </p>
      <Link
        to="/safesignal"
        className="inline-flex items-center gap-2 rounded-md border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Back to SafeSignal
      </Link>
    </div>
  );
}
