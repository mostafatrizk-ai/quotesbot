"""Token-bucket rate limiter مع Warm-up و Jitter — استراتيجية Anti-Ban.
مفهوم مستوحى من bandwith-io/ratelimit و أفضل ممارسات WhatsApp Cloud API.
"""
import random, threading, time

class TokenBucketRateLimiter:
    def __init__(self, messages_per_minute: int = 20, burst: int = 5,
                 jitter_seconds: float = 1.5, warmup_enabled: bool = True):
        self.rate = messages_per_minute / 60.0     # tokens/sec
        self.capacity = max(1, burst)
        self.jitter = jitter_seconds
        self.warmup = warmup_enabled
        self.tokens = 0.0 if warmup_enabled else self.capacity
        self.last = time.monotonic()
        self.started = time.monotonic()
        self._lock = threading.Lock()

    def _effective_rate(self) -> float:
        """تسخين تدريجي: أول 60 ثانية بنصف السرعة لحماية الرقم الجديد."""
        if self.warmup and time.monotonic() - self.started < 60:
            return self.rate * 0.5
        return self.rate

    def acquire(self) -> float:
        """يحجز حقنة واحدة؛ يعيد مدة الانتظار بالثواني (0 إن كان متاحًا)."""
        with self._lock:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self._effective_rate())
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                wait = random.uniform(0, self.jitter)   # عشوائية طبيعية ضد الأنماط الآلية
                time.sleep(wait)
                return wait
            need = (1 - self.tokens) / self._effective_rate()
            self.tokens = 0
            time.sleep(need)
            return need
