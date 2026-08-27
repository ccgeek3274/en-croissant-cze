import { useAtomValue } from "jotai";
import { moveNotationTypeAtom } from "@/state/atoms";
import { PIECE_SYMBOL_SPLIT, formatMove } from "@/utils/annotation";
import classes from "./MoveNotation.module.css";

/** Renders a SAN move in the notation style the user picked, enlarging piece glyphs. */
function MoveNotation({ move }: { move: string }) {
  const notation = useAtomValue(moveNotationTypeAtom);
  const text = formatMove(move, notation);

  if (notation !== "symbols") return <>{text}</>;

  return (
    <>
      {text.split(PIECE_SYMBOL_SPLIT).map((part, i) =>
        PIECE_SYMBOL_SPLIT.test(part) ? (
          <span key={i} className={classes.glyph}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default MoveNotation;
