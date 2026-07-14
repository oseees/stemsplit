import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

// On web the backend is reachable at localhost; on a device/emulator point this
// at your machine's LAN IP (e.g. http://192.168.1.20:3001).
const API_BASE =
  Platform.OS === "web" ? "http://localhost:3001" : "http://localhost:3001";

export default function App() {
  const [car, setCar] = useState("");
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function getRepairPlan() {
    if (!car.trim() || !task.trim()) {
      setError("Enter both a car and a repair task.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ car, task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <StatusBar style="light" />
      <Text style={styles.title}>🔧 Mechanic AI</Text>
      <Text style={styles.subtitle}>
        Tell me the car and the job. I'll list the tools, show the parts, and
        walk the steps.
      </Text>

      <Text style={styles.label}>Car</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 2015 Honda Civic"
        placeholderTextColor="#7a8290"
        value={car}
        onChangeText={setCar}
      />

      <Text style={styles.label}>Repair task</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        placeholder="e.g. Replace front brake pads"
        placeholderTextColor="#7a8290"
        value={task}
        onChangeText={setTask}
        multiline
      />

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={getRepairPlan}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#0b0e14" />
        ) : (
          <Text style={styles.buttonText}>Get Repair Plan</Text>
        )}
      </Pressable>

      {error && <Text style={styles.error}>⚠️ {error}</Text>}

      {result && (
        <View style={styles.results}>
          <ToolsCard tools={result.tools} />
          <PartsCard parts={result.parts} />
          <StepsCard steps={result.steps} />
        </View>
      )}
    </ScrollView>
  );
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ToolsCard({ tools }) {
  return (
    <Card title="🧰 Tools">
      {tools?.length ? (
        tools.map((t, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.rowText}>{t}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>None.</Text>
      )}
    </Card>
  );
}

function PartsCard({ parts }) {
  return (
    <Card title="📦 Parts">
      {parts?.length ? (
        parts.map((p, i) => (
          <View key={i} style={styles.partRow}>
            {p.imageUrl ? (
              <Image
                source={{ uri: p.imageUrl }}
                style={styles.partImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.partImage, styles.partImageEmpty]}>
                <Text style={styles.partImageEmptyText}>🔩</Text>
              </View>
            )}
            <Text style={styles.partName}>{p.name}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>None.</Text>
      )}
    </Card>
  );
}

function StepsCard({ steps }) {
  return (
    <Card title="📋 Steps">
      {steps?.length ? (
        steps.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <Text style={styles.stepNum}>{i + 1}.</Text>
            <View style={styles.stepBody}>
              <Text style={styles.rowText}>{s.instruction}</Text>
              {s.visual ? (
                <Text style={styles.stepVisual}>👁️ {s.visual}</Text>
              ) : null}
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>None.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0e14" },
  container: {
    padding: 24,
    paddingTop: 64,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 32, fontWeight: "800", color: "#f5f7fa" },
  subtitle: { fontSize: 15, color: "#9aa4b2", marginTop: 6, marginBottom: 24 },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#c4ccd8",
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: "#151a23",
    borderColor: "#262d3a",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#f5f7fa",
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  button: {
    backgroundColor: "#f5a623",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 24,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#0b0e14", fontSize: 16, fontWeight: "800" },
  error: { color: "#ff6b6b", marginTop: 18, fontSize: 15 },
  results: { marginTop: 28, gap: 16 },
  card: {
    backgroundColor: "#151a23",
    borderColor: "#262d3a",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#f5f7fa",
    marginBottom: 10,
  },
  row: { flexDirection: "row", marginBottom: 8 },
  bullet: { color: "#f5a623", fontWeight: "700", width: 26, fontSize: 15 },
  rowText: { color: "#dfe5ee", flex: 1, fontSize: 15, lineHeight: 21 },
  empty: { color: "#7a8290", fontStyle: "italic" },

  // Parts with photos
  partRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#222937",
    gap: 14,
  },
  partImage: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  partImageEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f1420",
  },
  partImageEmptyText: { fontSize: 26 },
  partName: { color: "#dfe5ee", flex: 1, fontSize: 15, fontWeight: "600" },

  // Steps with visual descriptions
  stepRow: { flexDirection: "row", marginBottom: 14 },
  stepNum: { color: "#f5a623", fontWeight: "700", width: 26, fontSize: 15 },
  stepBody: { flex: 1 },
  stepVisual: {
    color: "#9aa4b2",
    fontStyle: "italic",
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 4,
  },
});
