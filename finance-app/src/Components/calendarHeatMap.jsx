import "../styles/calendarHeatMap.css";
import "../styles/UserProgressTracker.css";
export default function CalendarHeatMap() {
  return (
    <div className="quick-actions">
      <div className="section-header">
        <h3 className="section-title">Contribution Habits</h3>
      </div>
      <div style={{ marginTop: "15px", paddingBottom: "5px" }}>
        <h4
          style={{
            fontSize: "14px",
            color: "var(--text-dark)",
            marginBottom: "8px",
          }}
        >
          Shares Pool Consistency
          <span style={{ float: "right", color: "var(--success)" }}>100%</span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "var(--success)",
            }}
          ></div>
        </div>

        <h4
          style={{
            fontSize: "14px",
            color: "var(--text-dark)",
            marginBottom: "8px",
          }}
        >
          Dev Fund Obligations
          <span style={{ float: "right", color: "var(--success)" }}>96%</span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: "96%",
              height: "100%",
              backgroundColor: "var(--success)",
            }}
          ></div>
        </div>

        <h4
          style={{
            fontSize: "14px",
            color: "var(--text-dark)",
            marginBottom: "8px",
          }}
        >
          Social Fund Activity
          <span style={{ float: "right", color: "#ff9800" }}>45%</span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "45%",
              height: "100%",
              backgroundColor: "#ff9800",
            }}
          ></div>
        </div>

        {/* Calendar Heatmap */}
        <div className="calendar-heatmap">
          <div className="heatmap-header">
            <div>
              <h4>Contribution Habit Tracker</h4>
              <p>Visualize your consistency over the year.</p>
            </div>
            <span>Green = contributed, Red = missed</span>
          </div>
          <div className="heatmap-months">
            <div className="heatmap-month">
              <span>Jan</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-3"
                  title="Jan Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jan Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Jan Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-0"
                  title="Jan Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jan Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Feb</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-2"
                  title="Feb Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Feb Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Feb Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Feb Week 4 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Mar</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-1"
                  title="Mar Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Mar Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Mar Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Mar Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Mar Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Apr</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-0"
                  title="Apr Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Apr Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Apr Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Apr Week 4 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>May</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-2"
                  title="May Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="May Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="May Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="May Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="May Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Jun</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-3"
                  title="Jun Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jun Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-0"
                  title="Jun Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jun Week 4 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Jul</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-3"
                  title="Jul Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Jul Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jul Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Jul Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Jul Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Aug</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-2"
                  title="Aug Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Aug Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Aug Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Aug Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Aug Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Sep</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-1"
                  title="Sep Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Sep Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-0"
                  title="Sep Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Sep Week 4 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Oct</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-2"
                  title="Oct Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Oct Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Oct Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Oct Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Oct Week 5 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Nov</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-1"
                  title="Nov Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Nov Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Nov Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-0"
                  title="Nov Week 4 Wednesday"
                ></div>
              </div>
            </div>
            <div className="heatmap-month">
              <span>Dec</span>
              <div className="heatmap-weekdays">
                <div
                  className="heatmap-day level-2"
                  title="Dec Week 1 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Dec Week 2 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-3"
                  title="Dec Week 3 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-2"
                  title="Dec Week 4 Wednesday"
                ></div>
                <div
                  className="heatmap-day level-1"
                  title="Dec Week 5 Wednesday"
                ></div>
              </div>
            </div>
          </div>
          <div className="heatmap-legend">
            <div className="heatmap-key">
              <span
                className="heatmap-key-dot level-0"
                title="Missed Contribution"
              ></span>
              <span className="heatmap-key-label">Missed</span>
              <span className="heatmap-key-label">Less</span>
              <span className="heatmap-key-dot level-1"></span>
              <span className="heatmap-key-dot level-2"></span>
              <span className="heatmap-key-dot level-3"></span>
              <span className="heatmap-key-label">More</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
