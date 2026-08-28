from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .services import build_dashboard_payload, update_dashboard_card_order


class DashboardView(generics.GenericAPIView):
    """`GET /api/v1/dashboard/` — réplica exacta de `src/app/api/dashboard/route.ts`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload = build_dashboard_payload(user=request.user, now=timezone.now())
        return Response(payload)


class DashboardCardOrderView(generics.GenericAPIView):
    """`PATCH /api/v1/dashboard/card-order/` — réplica exacta de
    `src/app/api/dashboard/card-order/route.ts`."""

    permission_classes = [IsAuthenticated]

    def patch(self, request):
        order = request.data.get("order")
        if not isinstance(order, list) or len(order) == 0:
            return Response({"error": "order debe ser un array no vacío"}, status=400)

        update_dashboard_card_order(user=request.user, order=order)
        return Response({"ok": True})
