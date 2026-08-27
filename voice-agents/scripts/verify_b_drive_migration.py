import argparse
from pathlib import Path


def verify_tree(root: Path, required: tuple[str, ...], forbidden_names: tuple[str, ...]) -> list[str]:
    errors = []
    for relative in required:
        if not (root / relative).exists():
            errors.append(f"missing: {relative}")
    for path in root.rglob("*"):
        if path.name in forbidden_names:
            errors.append(f"forbidden: {path.relative_to(root)}")
    return errors


def compare_files(left: Path, right: Path) -> bool:
    return left.is_file() and right.is_file() and left.read_bytes() == right.read_bytes()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the OmniRoute B-drive migration preflight.")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--required", nargs="*", default=[])
    parser.add_argument("--forbidden", nargs="*", default=[])
    parser.add_argument("--compare", nargs=2, metavar=("LEFT", "RIGHT"))
    args = parser.parse_args()

    errors = verify_tree(args.root, tuple(args.required), tuple(args.forbidden))
    if args.compare and not compare_files(Path(args.compare[0]), Path(args.compare[1])):
        errors.append(f"different: {args.compare[0]} != {args.compare[1]}")
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
