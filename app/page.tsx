import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <h1>A copy of the form you already use.</h1>
        <p>
          Fill a Daily Time Record from a name and a cutoff, or start from a form you already have.
          Accomplishment reports keep the letterhead and come back as aligned bullets.
        </p>
      </section>
      <section className="choices">
        <Link className="choice" href="/dtr">
          <strong>Daily Time Record</strong>
          <span>Enter a name, month, cutoff, and year. Weekdays fill through the cutoff. A printed form is optional.</span>
        </Link>
        <Link className="choice" href="/ar">
          <strong>Accomplishment Report</strong>
          <span>Keep the letterhead and the name on the form. Paste notes and get nested bullets, with room for screenshots.</span>
        </Link>
      </section>
    </main>
  );
}
