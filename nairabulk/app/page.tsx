const steps = [
  {
    title: "Join a campaign",
    body: "Pick a phone, tablet, laptop or accessory and commit to buy alongside other Nigerian buyers.",
  },
  {
    title: "The campaign unlocks",
    body: "When enough people commit before the deadline, the group hits the bulk-order target and the bulk price is locked in.",
  },
  {
    title: "We order, you save",
    body: "We place one bulk order with the supplier and every buyer pays the lower bulk price.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center">
        <p className="mb-4 inline-block rounded-full bg-accent-100 px-4 py-1 text-sm font-semibold text-accent-700">
          Group buying, Naija style
        </p>
        <h1 className="text-4xl font-bold sm:text-5xl">
          NairaBulk — <span className="text-primary-600">Bulk buy tech,</span>{" "}
          pay less
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          One person pays retail. A hundred people pay bulk. NairaBulk pools
          your order with other buyers so everyone unlocks wholesale pricing on
          tech sourced directly from suppliers.
        </p>
      </section>

      <section id="how-it-works" className="pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold">How it works</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {steps.map(({ title, body }, i) => (
            <li key={title} className="rounded-lg border border-gray-200 p-6">
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mb-2 font-semibold">{title}</h3>
              <p className="text-sm text-gray-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
