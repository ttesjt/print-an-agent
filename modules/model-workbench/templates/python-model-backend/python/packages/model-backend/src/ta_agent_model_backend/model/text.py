from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CharacterCodec:
    vocabulary: str
    unknown_character: str

    def __post_init__(self) -> None:
        if not self.vocabulary:
            raise ValueError("vocabulary must not be empty")
        if len(set(self.vocabulary)) != len(self.vocabulary):
            raise ValueError("vocabulary must not contain duplicate characters")
        if len(self.unknown_character) != 1 or self.unknown_character not in self.vocabulary:
            raise ValueError("unknown_character must identify one vocabulary character")

    @property
    def size(self) -> int:
        return len(self.vocabulary)

    def encode(self, text: str) -> list[int]:
        indices = {character: index for index, character in enumerate(self.vocabulary)}
        unknown_token = indices[self.unknown_character]
        return [indices.get(character, unknown_token) for character in text]

    def decode(self, tokens: list[int]) -> str:
        if any(token < 0 or token >= len(self.vocabulary) for token in tokens):
            raise ValueError("token is outside the configured vocabulary")
        return "".join(self.vocabulary[token] for token in tokens)
