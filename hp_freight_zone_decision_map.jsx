import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Truck, MapPin, Calculator, Package } from "lucide-react";

const HIGH_VALUE_SKUS = new Set([
  "W2120A",
  "CF360A",
  "CF410A",
  "W2123A",
  "W2122A",
  "W2121A",
  "CF360X",
  "CF361A",
  "W2120X",
  "CF450A",
  "CF363A",
  "CF362A",
  "CF283X",
  "CF361X",
  "W2020A",
  "CF362X",
  "W2122X",
  "CF451A",
  "W2121X",
  "B3P21A",
]);

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
}

function classifyZone(zip: string) {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  if (clean.length < 1) {
    return { zone: "Unknown", region: "Unknown", lane: "Unknown", freightRisk: "Unknown" };
  }

  const first = Number(clean[0]);

  if ([7].includes(first)) {
    return { zone: "Zone A", region: "Gulf / Nearby South", lane: "Short-haul", freightRisk: "Low" };
  }
  if ([3, 6].includes(first)) {
    return { zone: "Zone B", region: "Southeast / South-Central", lane: "Regional", freightRisk: "Low-Medium" };
  }
  if ([1, 4, 5].includes(first)) {
    return { zone: "Zone C", region: "Midwest / Central / Mid-Atlantic", lane: "Mid-haul", freightRisk: "Medium" };
  }
  if ([0, 2, 8].includes(first)) {
    return { zone: "Zone D", region: "Northeast / Mountain", lane: "Long-haul", freightRisk: "High" };
  }
  if ([9].includes(first)) {
    return { zone: "Zone E", region: "West Coast", lane: "Long-haul", freightRisk: "High" };
  }

  return { zone: "Unknown", region: "Unknown", lane: "Unknown", freightRisk: "Unknown" };
}

function getSkuProfile(rawSku: string) {
  const sku = normalizeSku(rawSku);

  if (HIGH_VALUE_SKUS.has(sku)) {
    return {
      sku,
      recognized: true,
      tier: "High-Value SKU",
      savingsRate: 0.028,
      bias: "Synnex",
      description: "This is a high-demand HP SKU with a deeper supplier spread.",
    };
  }

  if (!sku) {
    return {
      sku,
      recognized: false,
      tier: "No SKU Entered",
      savingsRate: 0.015,
      bias: "Neutral",
      description: "No SKU entered. Using blended economics.",
    };
  }

  return {
    sku,
    recognized: false,
    tier: "Standard SKU",
    savingsRate: 0.015,
    bias: "Neutral",
    description: "Standard SKU. Using blended economics rather than high-value SKU logic.",
  };
}

function autoMode({
  orderValue,
  zone,
  palletizable,
  isHighValue,
}: {
  orderValue: number;
  zone: string;
  palletizable: boolean;
  isHighValue: boolean;
}) {
  if (palletizable) {
    return {
      mode: "ltl",
      confidence: "High",
      reason: "Palletizable shipments should usually move LTL.",
    };
  }

  if (orderValue >= 10000) {
    return {
      mode: "ltl",
      confidence: "High",
      reason: "Larger orders usually justify LTL handling and linehaul.",
    };
  }

  if (orderValue < 3000) {
    return {
      mode: "ups",
      confidence: "High",
      reason: "Smaller orders are usually better suited for UPS / parcel handling.",
    };
  }

  if (["Zone D", "Zone E"].includes(zone) && orderValue >= 5000) {
    return {
      mode: "ltl",
      confidence: "Medium-High",
      reason: "Long-haul mid-sized orders often favor LTL over UPS.",
    };
  }

  if (isHighValue && orderValue >= 3000) {
    return {
      mode: "ltl",
      confidence: "Medium",
      reason: "High-value SKUs justify more deliberate routed fulfillment economics.",
    };
  }

  return {
    mode: "ups",
    confidence: "Medium",
    reason: "Defaulting to UPS because the shipment does not strongly justify LTL.",
  };
}

function estimateFreight(orderValue: number, mode: string, zone: string, sku: string) {
  const upsRanges: Record<string, [number, number]> = {
    "Zone A": [25, 50],
    "Zone B": [35, 70],
    "Zone C": [55, 100],
    "Zone D": [85, 150],
    "Zone E": [95, 170],
  };

  const ltlRanges: Record<string, [number, number]> = {
    "Zone A": [90, 130],
    "Zone B": [100, 150],
    "Zone C": [120, 180],
    "Zone D": [150, 230],
    "Zone E": [170, 260],
  };

  const handling: [number, number] = [10, 30];
  const ranges = mode === "ltl" ? ltlRanges : upsRanges;
  const freight = ranges[zone] || [0, 0];
  const skuProfile = getSkuProfile(sku);
  const savings = orderValue * skuProfile.savingsRate;

  return {
    freightLow: freight[0],
    freightHigh: freight[1],
    totalLow: freight[0] + handling[0],
    totalHigh: freight[1] + handling[1],
    savings,
    savingsRate: skuProfile.savingsRate,
    skuProfile,
  };
}

function decide({
  orderValue,
  zone,
  palletizable,
  sku,
  mode,
}: {
  orderValue: number;
  zone: string;
  palletizable: boolean;
  sku: string;
  mode: string;
}) {
  const est = estimateFreight(orderValue, mode, zone, sku);
  const pctLow = est.totalLow / Math.max(orderValue, 1);
  const pctHigh = est.totalHigh / Math.max(orderValue, 1);
  const isHighValue = est.skuProfile.tier === "High-Value SKU";

  if (isHighValue && orderValue >= 3000 && mode === "ltl") {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "High",
      reason:
        "This is a high-value HP SKU and the shipment profile supports routed fulfillment. The stronger product spread justifies Synnex at a lower threshold.",
      color: "green",
    };
  }

  if (orderValue >= 10000) {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "High",
      reason: "Large orders usually justify the supplier cost advantage and absorb handling and freight well.",
      color: "green",
    };
  }

  if (!isHighValue && orderValue < 5000 && mode === "ups") {
    return {
      route: "Distribution Management",
      confidence: "High",
      reason: "Standard SKUs on smaller parcel orders usually do not create enough savings after freight and handling.",
      color: "red",
    };
  }

  if (palletizable || mode === "ltl") {
    if (pctHigh <= est.savingsRate) {
      return {
        route: "TD Synnex → St. Rose",
        confidence: "Medium-High",
        reason: "The shipment profile supports routed fulfillment and estimated added cost stays within the available product spread.",
        color: "green",
      };
    }

    return {
      route: "Manual Review",
      confidence: "Medium",
      reason: "LTL profile looks operationally reasonable, but the economics are close enough that an exact quote should be checked.",
      color: "yellow",
    };
  }

  if (["Zone D", "Zone E"].includes(zone) && mode === "ups" && !isHighValue) {
    return {
      route: "Distribution Management",
      confidence: "Medium-High",
      reason: "Long-haul UPS lanes often eat most or all of the savings on standard SKUs.",
      color: "yellow",
    };
  }

  if (["Zone D", "Zone E"].includes(zone) && mode === "ups" && isHighValue && orderValue < 5000) {
    return {
      route: "Manual Review",
      confidence: "Medium",
      reason:
        "High-value SKU helps, but long-haul UPS can still compress the margin on smaller orders. Review exact freight before routing.",
      color: "yellow",
    };
  }

  if (pctHigh <= est.savingsRate * 0.65) {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "Medium",
      reason: "Estimated freight and handling appear low enough relative to expected SKU savings to preserve spread.",
      color: "green",
    };
  }

  if (pctLow >= est.savingsRate * 0.8) {
    return {
      route: "Distribution Management",
      confidence: "Medium",
      reason: "Estimated freight and handling consume too much of the expected product advantage.",
      color: "red",
    };
  }

  return {
    route: "Manual Review",
    confidence: "Medium",
    reason: "This order sits in the gray zone. Check the exact lane and carrier quote before routing.",
    color: "yellow",
  };
}

function ColorBadge({ color, children }: { color: string; children: React.ReactNode }) {
  const cls =
    color === "green"
      ? "bg-green-100 text-green-800 border-green-200"
      : color === "red"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-yellow-100 text-yellow-800 border-yellow-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${cls}`}>
      {children}
    </span>
  );
}

export default function HPFreightZoneDecisionMap() {
  const [zip, setZip] = useState("");
  const [sku, setSku] = useState("");
  const [orderValue, setOrderValue] = useState("5000");
  const [palletizable, setPalletizable] = useState("no");

  const zoneInfo = useMemo(() => classifyZone(zip), [zip]);
  const numericOrderValue = Number(orderValue || 0);
  const normalizedSku = useMemo(() => normalizeSku(sku), [sku]);
  const skuProfile = useMemo(() => getSkuProfile(normalizedSku), [normalizedSku]);

  const suggestedMode = useMemo(
    () =>
      autoMode({
        orderValue: numericOrderValue,
        zone: zoneInfo.zone,
        palletizable: palletizable === "yes",
        isHighValue: skuProfile.tier === "High-Value SKU",
      }),
    [numericOrderValue, zoneInfo.zone, palletizable, skuProfile.tier]
  );

  const est = useMemo(
    () => estimateFreight(numericOrderValue, suggestedMode.mode, zoneInfo.zone, normalizedSku),
    [numericOrderValue, suggestedMode.mode, zoneInfo.zone, normalizedSku]
  );

  const result = useMemo(
    () =>
      decide({
        orderValue: numericOrderValue,
        zone: zoneInfo.zone,
        palletizable: palletizable === "yes",
        sku: normalizedSku,
        mode: suggestedMode.mode,
      }),
    [numericOrderValue, zoneInfo.zone, palletizable, normalizedSku, suggestedMode.mode]
  );

  const spreadLow = est.savings - est.totalHigh;
  const spreadHigh = est.savings - est.totalLow;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">HP Freight Zone Decision Map</h1>
              <p className="mt-2 max-w-3xl text-slate-600">
                Enter destination ZIP, HP SKU, order value, and shipment profile to get a routing recommendation for
                <span className="font-semibold"> Distribution Management vs. TD Synnex → St. Rose</span>.
              </p>
            </div>
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
              Margin-Aware v3
            </Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="rounded-3xl shadow-sm lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Inputs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Destination ZIP</Label>
                <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 98433" />
              </div>

              <div className="space-y-2">
                <Label>HP SKU</Label>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  placeholder="e.g. CF410A"
                />
              </div>

              <div className="space-y-2">
                <Label>Order Value ($)</Label>
                <Input
                  value={orderValue}
                  onChange={(e) => setOrderValue(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="5000"
                />
              </div>

              <div className="space-y-2">
                <Label>Palletizable?</Label>
                <Select value={palletizable} onValueChange={setPalletizable}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
                Shipping method is now auto-suggested from order size, lane profile, palletization, and SKU economics.
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  SKU Economics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Normalized SKU</div>
                    <div className="mt-1 text-xl font-semibold">{skuProfile.sku || "—"}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">SKU Tier</div>
                    <div className="mt-1 text-xl font-semibold">{skuProfile.tier}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Savings Rate</div>
                    <div className="mt-1 text-xl font-semibold">{(est.savingsRate * 100).toFixed(1)}%</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Supplier Bias</div>
                    <div className="mt-1 text-xl font-semibold">{skuProfile.bias}</div>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-600">{skuProfile.description}</p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Lane Classification
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Zone</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.zone}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Region</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.region}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Lane</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.lane}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Freight Risk</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.freightRisk}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Shipping Method Suggestion
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <ColorBadge color={suggestedMode.mode === "ltl" ? "green" : "yellow"}>
                    {suggestedMode.mode === "ltl" ? "Suggest LTL / Estes" : "Suggest UPS Ground / Parcel"}
                  </ColorBadge>
                  <ColorBadge color={suggestedMode.mode === "ltl" ? "green" : "yellow"}>
                    Confidence: {suggestedMode.confidence}
                  </ColorBadge>
                </div>
                <p className="text-slate-700">{suggestedMode.reason}</p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Routing Recommendation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <ColorBadge color={result.color}>{result.route}</ColorBadge>
                  <ColorBadge color={result.color}>Confidence: {result.confidence}</ColorBadge>
                </div>
                <p className="text-slate-700">{result.reason}</p>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="rounded-3xl shadow-sm">
                <CardHeader>
                  <CardTitle>Estimated Economics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span>Product Savings ({(est.savingsRate * 100).toFixed(1)}%)</span>
                    <span className="font-semibold">${est.savings.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Suggested Shipping Mode</span>
                    <span className="font-semibold">{suggestedMode.mode.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Freight Estimate</span>
                    <span className="font-semibold">
                      ${est.freightLow.toFixed(0)}–${est.freightHigh.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Added Cost</span>
                    <span className="font-semibold">
                      ${est.totalLow.toFixed(0)}–${est.totalHigh.toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-between border-t pt-3 text-base">
                    <span>Estimated Spread</span>
                    <span className="font-bold">
                      ${spreadLow.toFixed(0)} to ${spreadHigh.toFixed(0)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl shadow-sm">
                <CardHeader>
                  <CardTitle>Operating Rules</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                    <span><strong>Palletizable</strong>: usually suggest LTL.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                    <span><strong>$10K+</strong>: usually suggest LTL and favor Synnex.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-yellow-600" />
                    <span><strong>Small orders</strong>: usually suggest UPS.</span>
                  </div>
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
                    <span><strong>Long-haul UPS + standard SKU</strong>: often favors DM.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
                    <span><strong>High-value SKU</strong>: lowers the threshold for routed Synnex fulfillment.</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
