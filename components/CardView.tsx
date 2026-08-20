import { Card, RANK_LABEL, SUIT_SYMBOL } from "@/lib/deck.ts";

export default function CardView({ card, faceDown = false, small = false, winning = false }: { card?: Card; faceDown?: boolean; small?: boolean; winning?: boolean }) {
  if (faceDown || !card) {
    return (
      <div className={small ? "card small back" : "card back"}>
        <span className="back-pattern">★</span>
      </div>
    );
  }
  const red = card.suit === "h" || card.suit === "d";
  const cls = ["card", small ? "small" : "", winning ? "winning" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} style={{ color: red ? "#e23b3b" : "#1a1a1a" }}>
      <span className="rank">{RANK_LABEL[card.rank]}</span>
      <span className="suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
