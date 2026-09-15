from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping

import torch
from torch import Tensor

from .constants import EMBEDDED_TRAINING_TEXT, MODEL_VOCABULARY, UNKNOWN_CHARACTER
from .contracts import (
    ExportedModel,
    ModelCheckpoint,
    TinyTransformerConfiguration,
    TorchRuntime,
    TrainingProgress,
    TrainingResult,
)
from .runtime import torch_device, torch_dtype
from .text import CharacterCodec
from .transformer import TinyTransformer, count_parameters

ProgressCallback = Callable[[TrainingProgress], None]
CancellationCheck = Callable[[], None]


class TinyTransformerService:
    def initialize(
        self,
        configuration: TinyTransformerConfiguration,
        runtime: TorchRuntime,
        *,
        seed: int,
    ) -> ModelCheckpoint:
        _seed(seed)
        model = TinyTransformer(configuration).to(
            device=torch_device(runtime), dtype=torch_dtype(runtime)
        )
        return _checkpoint(model, MODEL_VOCABULARY)

    def train(
        self,
        source: ModelCheckpoint,
        runtime: TorchRuntime,
        *,
        steps: int,
        batch_size: int,
        learning_rate: float,
        seed: int,
        report_progress: ProgressCallback,
        check_cancellation: CancellationCheck,
    ) -> TrainingResult:
        _seed(seed)
        device = torch_device(runtime)
        codec = CharacterCodec(source.vocabulary, UNKNOWN_CHARACTER)
        model = _load_model(source, runtime)
        model.train()
        optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
        corpus = torch.tensor(codec.encode(EMBEDDED_TRAINING_TEXT), dtype=torch.long)
        generator = torch.Generator(device="cpu").manual_seed(seed)
        initial_loss: float | None = None
        final_loss: float | None = None
        for step in range(1, steps + 1):
            check_cancellation()
            inputs, targets = _sample_batch(
                corpus,
                context_length=source.configuration.context_length,
                batch_size=batch_size,
                generator=generator,
                device=device,
            )
            _logits, loss = model(inputs, targets)
            if loss is None:
                raise RuntimeError("training model did not produce a loss")
            loss_value = float(loss.detach().to(device="cpu", dtype=torch.float32).item())
            if not math.isfinite(loss_value):
                raise RuntimeError("training produced a non-finite loss")
            if initial_loss is None:
                initial_loss = loss_value
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            final_loss = loss_value
            report_progress(TrainingProgress(step=step, total_steps=steps, loss=loss_value))
        check_cancellation()
        if initial_loss is None or final_loss is None:
            raise RuntimeError("training completed without a loss")
        return TrainingResult(
            checkpoint=_checkpoint(model, source.vocabulary),
            steps=steps,
            initial_loss=initial_loss,
            final_loss=final_loss,
        )

    def export(self, source: ModelCheckpoint) -> ExportedModel:
        _create_loaded_model(source)
        return ExportedModel(
            configuration=source.configuration,
            vocabulary=source.vocabulary,
            state=_copy_state_to_cpu(source.state),
            parameter_count=source.parameter_count,
        )

    def generate(
        self,
        exported: ExportedModel,
        runtime: TorchRuntime,
        *,
        prompt: str,
        maximum_new_tokens: int,
        check_cancellation: CancellationCheck,
    ) -> Iterator[str]:
        codec = CharacterCodec(exported.vocabulary, UNKNOWN_CHARACTER)
        prompt_tokens = codec.encode(prompt)
        if not prompt_tokens:
            raise ValueError("prompt must not be empty")
        checkpoint = ModelCheckpoint(
            configuration=exported.configuration,
            vocabulary=exported.vocabulary,
            state=exported.state,
            parameter_count=exported.parameter_count,
        )
        model = _load_model(checkpoint, runtime)
        model.eval()
        device = torch_device(runtime)
        tokens = torch.tensor([prompt_tokens], dtype=torch.long, device=device)
        with torch.no_grad():
            for _ in range(maximum_new_tokens):
                check_cancellation()
                context = tokens[:, -exported.configuration.context_length :]
                logits, _loss = model(context)
                next_token = torch.argmax(logits[:, -1, :], dim=-1, keepdim=True)
                tokens = torch.cat((tokens, next_token), dim=1)
                yield codec.decode([int(next_token.item())])


def _load_model(source: ModelCheckpoint, runtime: TorchRuntime) -> TinyTransformer:
    model = _create_loaded_model(source)
    loaded_model: TinyTransformer = model.to(
        device=torch_device(runtime), dtype=torch_dtype(runtime)
    )
    return loaded_model


def _create_loaded_model(source: ModelCheckpoint) -> TinyTransformer:
    model = TinyTransformer(source.configuration)
    if count_parameters(model) != source.parameter_count:
        raise ValueError("checkpoint parameter count does not match its configuration")
    model.load_state_dict(source.state, strict=True)
    return model


def _checkpoint(model: TinyTransformer, vocabulary: str) -> ModelCheckpoint:
    return ModelCheckpoint(
        configuration=model.configuration,
        vocabulary=vocabulary,
        state=_copy_state_to_cpu(model.state_dict()),
        parameter_count=count_parameters(model),
    )


def _copy_state_to_cpu(state: Mapping[str, Tensor]) -> dict[str, Tensor]:
    return {name: tensor.detach().to(device="cpu").clone() for name, tensor in state.items()}


def _sample_batch(
    corpus: Tensor,
    *,
    context_length: int,
    batch_size: int,
    generator: torch.Generator,
    device: torch.device,
) -> tuple[Tensor, Tensor]:
    maximum_start = corpus.numel() - context_length - 1
    if maximum_start < 1:
        raise ValueError("embedded training text is shorter than the configured context length")
    starts = torch.randint(maximum_start + 1, (batch_size,), generator=generator)
    inputs = torch.stack([corpus[int(start) : int(start) + context_length] for start in starts])
    targets = torch.stack(
        [corpus[int(start) + 1 : int(start) + context_length + 1] for start in starts]
    )
    return inputs.to(device=device), targets.to(device=device)


def _seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


__all__ = ["TinyTransformerService"]
