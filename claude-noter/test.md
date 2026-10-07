# Test — fælder og fremgangsmåde

> Flyttet ordret fra `CLAUDE.md` (2026-10-07).

- **Prøver mod `runes/spolen.yaml` skal pakke scalaren UD først** (se `scriptet()`
  i `tests/version.test.js`). YAML skriver lange scripts som ét dobbeltciteret
  scalar med `\n`, `\"` og ombrydning midt i linjerne, så et regulært udtryk over
  rå YAML-tekst rammer tilfældigt: `node app/kilde.js` findes, men `K="$K"` gør ikke.
  Afkodningen er tjekket mod pyyamls egen — byte for byte.
- **Sabotér dine egne prøver, før du tror på dem.** De fem sabotager af `beregn.js`
  (huller, fremdriftens nævner, fortids-vagten i `naesteTjek`, specials-standarden,
  afsnit uden dato) skal alle gøre suiten **rød**. En grøn suite, der bliver grøn
  under sabotage, beviser ingenting.
- **Isolationsprøven skal køres med en RIGTIGT registreret anden bruger.** Første
  forsøg 2026-08-28 så grønt ud, men bruger nr. 2 var aldrig oprettet
  (`allow_registration` er som standard slået fra) — alle "tomme" svar var i
  virkeligheden *"not signed in"*. Åbn registreringen som admin først.
- Browser-panen: programmatisk rulning fyrer hverken `scroll` eller
  `IntersectionObserver`, og syntetiske keydown har tom `e.key`. Mål strukturelt
  med `read_page`/`javascript_tool` — og mål **geometrien**, ikke kun DOM'en.
