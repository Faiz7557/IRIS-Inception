import os
from uuid import uuid4

import pytest
from cryptography.exceptions import InvalidTag

import crypto

U = uuid4()


def test_roundtrip_and_version_byte():
    blob = crypto.encrypt("Budi Santoso", "profiles", "nickname", U)
    assert blob[0] == 2  # highest configured key version (conftest sets V1, V2)
    assert crypto.decrypt(blob, "profiles", "nickname", U) == "Budi Santoso"


def test_random_nonce():
    assert crypto.encrypt("x", "t", "c", U) != crypto.encrypt("x", "t", "c", U)


@pytest.mark.parametrize("table,col,uid", [("other", "nickname", U), ("profiles", "address", U), ("profiles", "nickname", uuid4())])
def test_wrong_aad_fails(table, col, uid):
    blob = crypto.encrypt("rahasia", "profiles", "nickname", U)
    with pytest.raises(InvalidTag):
        crypto.decrypt(blob, table, col, uid)


def test_old_key_version_still_decrypts():
    blob = crypto.encrypt("lama", "profiles", "address", U, version=1)
    assert blob[0] == 1
    assert crypto.decrypt(blob, "profiles", "address", U) == "lama"


def test_missing_key_version():
    with pytest.raises(KeyError):
        crypto.decrypt(b"\x09" + os.urandom(40), "t", "c", U)
