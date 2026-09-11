"""Quick check of the offline SMS fallback logic in backend/main.py."""

import backend.main as m


def test_phone_normalization():
    assert m.normalize_phone_number("98765 43210") == "+9876543210"
    assert m.normalize_phone_number("+91 98765 43210") == "+919876543210"
    assert m.normalize_phone_number("00 91 98765 43210") == "+919876543210"
    assert m.normalize_phone_number("123") is None
    assert m.normalize_phone_number(None) is None


def test_offline_device_is_texted():
    m.push_subscriptions.clear()
    m._offline_phone_numbers.clear()

    m.push_subscriptions["https://push/1"] = m.PushSubscription(
        endpoint="https://push/1",
        keys={"p256dh": "a", "auth": "b"},
        phone_number="+919876543210",
    )
    # The device drops offline: its push subscription is retired and the phone
    # number is remembered for the SMS fallback.
    m.mark_device_offline("https://push/1")
    assert "https://push/1" not in m.push_subscriptions
    assert m._offline_phone_numbers["https://push/1"] == "+919876543210"

    result = m.send_offline_sms_fallback("Assam", "critical", "Evacuate now")
    assert result.attempted == 1
    assert result.sent == 1
    assert result.failed == 0
    # A delivered fallback is not repeated on the next alert.
    assert m._offline_phone_numbers == {}


def test_online_device_needs_no_sms():
    m.push_subscriptions.clear()
    m._offline_phone_numbers.clear()
    result = m.send_offline_sms_fallback("Assam", "high", "Stay indoors")
    assert result.attempted == 0


def test_subscribe_keeps_phone_for_fallback():
    m.push_subscriptions.clear()
    m._offline_phone_numbers.clear()
    response = m.push_subscribe(
        m.PushSubscription(
            endpoint="https://push/2",
            keys={"p256dh": "a", "auth": "b"},
            phone_number="+91 98765 00000",
        )
    )
    assert response.sms_fallback is True
    assert m.push_subscriptions["https://push/2"].phone_number == "+919876500000"


if __name__ == "__main__":
    test_phone_normalization()
    test_offline_device_is_texted()
    test_online_device_needs_no_sms()
    test_subscribe_keeps_phone_for_fallback()
    print("all offline SMS fallback checks passed")
