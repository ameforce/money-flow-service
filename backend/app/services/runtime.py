from __future__ import annotations

from app.services.dashboard import DashboardService
from app.services.fx_service import FxService
from app.services.importer import WorkbookImporter
from app.services.price_service import PriceService
from app.services.ws_hub import HouseholdHub


hub = HouseholdHub()
price_service = PriceService()
fx_service = FxService()
dashboard_service = DashboardService(price_service=price_service, fx_service=fx_service)
importer = WorkbookImporter()

