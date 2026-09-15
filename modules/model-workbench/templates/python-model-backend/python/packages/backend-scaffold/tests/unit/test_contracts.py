from __future__ import annotations

import pytest

from ta_agent_model_backend_scaffold import ScaffoldIdentityError, TemplateIdentity


def test_identity_derives_python_package_name() -> None:
    identity = TemplateIdentity.from_project_name("small-language-model")

    assert identity.project_name == "small-language-model"
    assert identity.package_name == "small_language_model"


@pytest.mark.parametrize(
    ("project_name", "package_name"),
    [
        ("Uppercase", "uppercase"),
        ("valid-project", "invalid-package"),
        ("valid-project", "class"),
        ("valid-project", ""),
    ],
)
def test_identity_rejects_unsafe_names(project_name: str, package_name: str) -> None:
    with pytest.raises(ScaffoldIdentityError):
        TemplateIdentity(project_name=project_name, package_name=package_name)
