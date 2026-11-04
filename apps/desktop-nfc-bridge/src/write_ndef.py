#!/usr/bin/env python3
import json
import sys
import time

def ndef_uri(url: str) -> bytes:
    uri = url.encode("utf-8")
    if len(uri) > 249:
        raise ValueError("Canonical URL exceeds this writer's short NDEF message limit")
    record = bytes([0xD1, 0x01, len(uri) + 1, 0x55, 0x00]) + uri
    tlv = bytes([0x03, len(record)]) + record + bytes([0xFE])
    return tlv + bytes((-len(tlv)) % 4)


def parse_ndef_uri(raw: bytes) -> str:
    start = raw.index(0x03)
    cursor = start + 1
    if raw[cursor] == 0xFF:
        length = int.from_bytes(raw[cursor + 1:cursor + 3], "big")
        cursor += 3
    else:
        length = raw[cursor]
        cursor += 1
    message = raw[cursor:cursor + length]
    if len(message) != length or len(message) < 6 or message[:2] != bytes([0xD1, 0x01]) or message[3:5] != bytes([0x55, 0x00]):
        raise ValueError("Read-back is not an absolute NDEF URI record")
    payload_length = message[2]
    if payload_length + 4 != len(message):
        raise ValueError("Truncated or invalid NDEF payload")
    return message[5:4 + payload_length].decode("utf-8")


def validate_capacity(capability: bytes, size: int):
    if len(capability) < 4 or capability[0] != 0xE1 or capability[1] >> 4 != 1:
        raise ValueError("Only NFC Forum Type 2 tags with a valid capability container are supported")
    if capability[3] != 0:
        raise ValueError("Tag requires authentication or is read-only")
    if size > capability[2] * 8:
        raise ValueError("NDEF message exceeds tag capacity")


def transmit(connection, command):
    data, sw1, sw2 = connection.transmit(command)
    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError(f"PC/SC command failed: {sw1:02X}{sw2:02X}")
    return bytes(data)


def main():
    try:
        from smartcard.System import readers
        from smartcard.Exceptions import NoCardException
    except ImportError:
        raise RuntimeError("Install pyscard in your Python environment before using a PC/SC reader")
    if len(sys.argv) != 2:
        raise ValueError("Expected the canonical URL")
    url = sys.argv[1]
    available = readers()
    if not available:
        raise RuntimeError("No PC/SC NFC reader was detected")
    reader = available[0]
    connection = reader.createConnection()
    deadline = time.time() + 170
    while True:
        try:
            connection.connect()
            break
        except NoCardException:
            if time.time() >= deadline:
                raise RuntimeError("Timed out waiting for an NFC card")
            time.sleep(0.25)

    encoded = ndef_uri(url)
    capability = transmit(connection, [0xFF, 0xB0, 0x00, 0x03, 0x04])
    validate_capacity(capability, len(encoded))
    for offset in range(0, len(encoded), 4):
        page = 4 + offset // 4
        transmit(connection, [0xFF, 0xD6, 0x00, page, 0x04, *encoded[offset:offset + 4]])
    readback = b"".join(transmit(connection, [0xFF, 0xB0, 0x00, 4 + offset // 4, min(16, len(encoded) - offset)])
                        for offset in range(0, len(encoded), 16))
    print(json.dumps({
        "reader": str(reader),
        "readbackUrl": parse_ndef_uri(readback),
        "bytesWritten": len(encoded),
        "tagFamily": "NFC Forum Type 2"
    }))
    connection.disconnect()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
