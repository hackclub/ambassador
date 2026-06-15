const questions = [
  {
    question: "What would I do?",
    answers: (
      <>
        <p>
          Help spread the word about Hack Club Stardance! 
        </p>
        <ul className="space-y-2 pl-6 list-disc">
          <li>
            Put up Stardance Challenge posters.
          </li>
          <li>
            Share your referral links with likeminded teens.
          </li>
        </ul>
        <p>You can also run Stardance Expeditions (meetups) in your city!</p>
      </>
    ),
  },
  {
    question: "What do I get?",
    answers: (
      <ul className="space-y-2 pl-6 list-disc">
        <li>
          <strong>$100 guaranteed honorarium</strong>, as long as you run 2 or
          more meetups in June, July, and August (paid at the end of August!)
        </li>
        <li>
          $20 fund for any supplies like paper, printer ink, pins, and blu-tack
          to put up posters - this can be topped up if you need more
        </li>
        <li>A Hack Club-branded t-shirt to wear with pride!</li>
        <li>
          <p>
            $1.00 for every poster you put up (with a photo!), and $0.50 for
            every person who signs up and verifies themselves as under 18
          </p>
          <p className="mt-0.5 text-base leading-relaxed text-neutral-600">
            example: if you put up 15 posters in a month, and 10 people sign up{" "}
            <span className="underline">per poster</span>, that&rsquo;s $15 +
            $75 = $90 for that month!
          </p>
        </li>
      </ul>
    ),
  },
  {
    question: "How does this work?",
    answers: (
      <>
        <p>
          We&rsquo;ve already made some amazing posters for you, so all you have
          to do is print them out from our platform and put them up for people
          to see! Please remember to follow any local laws about putting up
          posters - you could look into places like local shops or community
          boards.
        </p>
        <p>
          You can also share your referral links with likeminded teens. The more people who sign up with your referral link, the more you earn!.
        </p>
      </>
    ),
  },
  {
    question: "Who can apply?",
    answers: (
      <>
        <p>
          Teenagers aged 13-18 from the United States, United Kingdom, Canada,
          Europe, Australia, and New Zealand can apply. You&rsquo;ll need to be
          able to get to places around your city - this may involve walking,
          biking, driving, or taking public transit, it&rsquo;s up to you.
        </p>
        <p>
          We hope to add more countries in the future, but this is a brand new
          program, so we&rsquo;re trying it out first in a small number of
          areas.
        </p>
      </>
    ),
  },
  {
    question: "Do I need to run a Stardance Expedition to be an ambassador?",
    answers: (
      <>
        <p>
          We highly recommend you run Stardance Expeditions, but it is not a hard requirement. If you do not run the Stardance Expeditions you will not be eligible for the $100 honorarium.
        </p>
      </>
    )
  },
  {
    question: "What does a Stardance Expedition look like?",
    answers: (
      <>
        <p>
          A Stardance Expedition isn&apos;t anything big like a Campfire or a Daydream.
          It&apos;s just you and some Hack Clubbers from your city hanging
          out and making projects! This is not a formal event.
        </p>
      </>
    )
  }
] as const;

export default function Questions() {
  return (
    <div className="p-12 relative max-w-7xl mx-auto" id="faq">
      <h2 className="text-4xl md:text-5xl font-jersey">
        Questions you might have
      </h2>
      <div className="mt-6 border-t border-neutral-300">
        {questions.map((item) => (
          <div
            key={item.question}
            className="py-4 border-b border-neutral-300 leading-relaxed text-lg md:text-xl"
          >
            <p className="font-bold">{item.question}</p>
            <div className="mt-2 space-y-2">{item.answers}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xl md:text-2xl  leading-relaxed">
        If your question isn&rsquo;t answered here, you can always ask in{" "}
        <strong>#ambassador</strong> or email us,{" "}
        <strong>ambassadors@hackclub.com</strong>.
      </p>
    </div>
  );
}
